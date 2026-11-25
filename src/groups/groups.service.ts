import { SystemMessagesService } from '../system-messages/system-messages.service';
import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';

import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  pairKey,
  socialTransaction,
} from '../common/social-transaction';

import { conversationInclude } from '../conversations/conversation-select';

import { UpdateGroupDto } from './dto/update-group.dto';
import { GROUP_EVENTS } from './events/group.events';

import type { GroupEvent } from './events/group.events';

@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly systemMessages: SystemMessagesService,
  ) {}

  private async requireGroup(
    tx: Prisma.TransactionClient,
    conversationId: string,
    userId: string,
  ) {
    const group = await tx.conversation.findFirst({
      where: {
        id: conversationId,
        type: 'GROUP',
        members: {
          some: {
            userId,
            leftAt: null,
          },
        },
      },
      include: {
        members: {
          where: { leftAt: null },
        },
      },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    const actor = group.members.find(
      member => member.userId === userId,
    )!;

    return { group, actor };
  }

  private requireManager(role: string) {
    if (role !== 'OWNER' && role !== 'ADMIN') {
      throw new ForbiddenException(
        'Group administrator privileges required',
      );
    }
  }

  private requireOwner(role: string) {
    if (role !== 'OWNER') {
      throw new ForbiddenException(
        'Group owner privileges required',
      );
    }
  }

  private emit(
    event: string,
    conversationId: string,
    actorId: string,
    affectedUserIds: string[] = [],
  ) {
    const payload: GroupEvent = {
      conversationId,
      actorId,
      affectedUserIds,
    };

    this.events.emit(event, payload);
  }

  async update(
    userId: string,
    conversationId: string,
    dto: UpdateGroupDto,
  ) {
    conversationId = conversationId.toLowerCase();

    if (
      dto.name === undefined &&
      dto.description === undefined
    ) {
      throw new BadRequestException(
        'No changes provided',
      );
    }

    const result = await socialTransaction(
      this.prisma,
      async tx => {
        const { group, actor } = await this.requireGroup(
          tx,
          conversationId,
          userId,
        );

        this.requireManager(actor.role);

        const actorName = await this.systemMessages.displayName(tx, userId);
        const changes: string[] = [];

        if (dto.name !== undefined && dto.name.trim() !== group.name) {
          changes.push(`${actorName} zmienił nazwę grupy na „${dto.name.trim()}”.`);
        }

        if (dto.description !== undefined && dto.description.trim() !== (group.description ?? '')) {
          changes.push(`${actorName} zmienił opis grupy.`);
        }

        const messages = [];

        for (const content of changes) {
          messages.push(await this.systemMessages.create(
            tx, conversationId, userId, content,
          ));
        }

        const conversation = await tx.conversation.update({
          where: { id: conversationId },
          data: {
            name: dto.name?.trim(),
            description: dto.description?.trim(),
          },
          include: conversationInclude,
        });

        return { conversation, messages };
      },
    );

    this.emit(
      GROUP_EVENTS.UPDATED,
      conversationId,
      userId,
    );

    for (const message of result.messages) {
      await this.systemMessages.publish(message);
    }

    return result.conversation;
  }

  async addMembers(
    userId: string,
    conversationId: string,
    memberIds: string[],
  ) {
    conversationId = conversationId.toLowerCase();

    const ids = [...new Set(
      memberIds.map(id => id.toLowerCase()),
    )];

    const result = await socialTransaction(
      this.prisma,
      async tx => {
        const { group, actor } =
          await this.requireGroup(
            tx,
            conversationId,
            userId,
          );

        this.requireManager(actor.role);

        const existingIds = new Set(
          group.members.map(member => member.userId),
        );

        const newIds = ids.filter(
          id => !existingIds.has(id),
        );

        if (!newIds.length) {
          throw new ConflictException(
            'Users are already group members',
          );
        }

        if (group.members.length + newIds.length > 50) {
          throw new BadRequestException(
            'Group member limit exceeded',
          );
        }

        const users = await tx.user.count({
          where: {
            id: { in: newIds },
            status: 'ACTIVE',
          },
        });

        if (users !== newIds.length) {
          throw new NotFoundException(
            'One or more users not found',
          );
        }

        const friendships = await tx.friendship.count({
          where: {
            status: 'ACCEPTED',
            pairKey: {
              in: newIds.map(
                id => pairKey(userId, id),
              ),
            },
          },
        });

        if (friendships !== newIds.length) {
          throw new ForbiddenException(
            'You can only invite your friends',
          );
        }

        const allIds = [
          ...existingIds,
          ...newIds,
        ];

        const block = await tx.block.findFirst({
          where: {
            OR: [
              {
                blockerId: { in: newIds },
                blockedId: { in: allIds },
              },
              {
                blockerId: { in: allIds },
                blockedId: { in: newIds },
              },
            ],
          },
        });

        if (block) {
          throw new ForbiddenException(
            'Cannot add these users',
          );
        }

        for (const id of newIds) {
          await tx.conversationMember.upsert({
            where: {
              conversationId_userId: {
                conversationId,
                userId: id,
              },
            },
            create: {
              conversationId,
              userId: id,
              role: 'MEMBER',
            },
            update: {
              role: 'MEMBER',
              leftAt: null,
              archived: false,
              nickname: null,
              mutedUntil: null,
              lastReadAt: null,
              joinedAt: new Date(),
            },
          });
        }

        const actorName = await this.systemMessages.displayName(tx, userId);
        const messages = [];

        for (const id of newIds) {
          const targetName = await this.systemMessages.displayName(tx, id);

          messages.push(await this.systemMessages.create(
            tx,
            conversationId,
            userId,
            `${actorName} dodał ${targetName} do grupy.`,
          ));
        }

        const conversation =
          await tx.conversation.update({
            where: { id: conversationId },
            data: { updatedAt: new Date() },
            include: conversationInclude,
          });

        return {
          conversation,
          addedUserIds: newIds,
          messages,
        };
      },
    );

    this.emit(
      GROUP_EVENTS.MEMBERS_ADDED,
      conversationId,
      userId,
      result.addedUserIds,
    );

    for (const message of result.messages) {
      await this.systemMessages.publish(message);
    }

    return result.conversation;
  }

  async removeMember(
    userId: string,
    conversationId: string,
    targetId: string,
  ) {
    conversationId = conversationId.toLowerCase();
    targetId = targetId.toLowerCase();

    if (userId === targetId) {
      throw new BadRequestException(
        'Use the leave group endpoint',
      );
    }

    const message = await socialTransaction(
      this.prisma,
      async tx => {
        const { group, actor } =
          await this.requireGroup(
            tx,
            conversationId,
            userId,
          );

        this.requireManager(actor.role);

        const target = group.members.find(
          member => member.userId === targetId,
        );

        if (!target) {
          throw new NotFoundException(
            'Group member not found',
          );
        }

        if (target.role === 'OWNER') {
          throw new ForbiddenException(
            'Cannot remove the group owner',
          );
        }

        if (
          target.role === 'ADMIN' &&
          actor.role !== 'OWNER'
        ) {
          throw new ForbiddenException(
            'Only the owner can remove administrators',
          );
        }

        await tx.conversationMember.update({
          where: { id: target.id },
          data: {
            leftAt: new Date(),
            role: 'MEMBER',
          },
        });

        const actorName = await this.systemMessages.displayName(tx, userId);
        const targetName = await this.systemMessages.displayName(tx, targetId);

        return this.systemMessages.create(
          tx,
          conversationId,
          userId,
          `${actorName} usunął ${targetName} z grupy.`,
        );
      },
    );

    this.emit(
      GROUP_EVENTS.MEMBER_REMOVED,
      conversationId,
      userId,
      [targetId],
    );

    await this.systemMessages.publish(message);

    return { success: true };
  }

  async updateRole(
    userId: string,
    conversationId: string,
    targetId: string,
    role: 'ADMIN' | 'MEMBER',
  ) {
    conversationId = conversationId.toLowerCase();
    targetId = targetId.toLowerCase();

    if (role !== 'ADMIN' && role !== 'MEMBER') {
      throw new BadRequestException('Invalid role');
    }

    const result = await socialTransaction(
      this.prisma,
      async tx => {
        const { group, actor } =
          await this.requireGroup(
            tx,
            conversationId,
            userId,
          );

        this.requireOwner(actor.role);

        const target = group.members.find(
          member => member.userId === targetId,
        );

        if (!target) {
          throw new NotFoundException(
            'Group member not found',
          );
        }

        if (target.role === 'OWNER') {
          throw new ForbiddenException(
            'Cannot change owner role directly',
          );
        }

        if (target.role === role) {
          return { changed: false, message: null };
        }

        await tx.conversationMember.update({
          where: { id: target.id },
          data: { role },
        });

        const targetName = await this.systemMessages.displayName(tx, targetId);

        const message = await this.systemMessages.create(
          tx,
          conversationId,
          userId,
          role === 'ADMIN'
            ? `${targetName} został administratorem grupy.`
            : `${targetName} nie jest już administratorem grupy.`,
        );

        return { changed: true, message };
      },
    );

    if (result.changed) {
      this.emit(
        GROUP_EVENTS.ROLE_UPDATED,
        conversationId,
        userId,
        [targetId],
      );
    }

    if (result.message) {
      await this.systemMessages.publish(result.message);
    }

    return { success: true };
  }

  async transferOwner(
    userId: string,
    conversationId: string,
    targetId: string,
  ) {
    conversationId = conversationId.toLowerCase();
    targetId = targetId.toLowerCase();

    if (userId === targetId) {
      throw new BadRequestException(
        'You already own this group',
      );
    }

    const message = await socialTransaction(
      this.prisma,
      async tx => {
        const { group, actor } =
          await this.requireGroup(
            tx,
            conversationId,
            userId,
          );

        this.requireOwner(actor.role);

        const target = group.members.find(
          member => member.userId === targetId,
        );

        if (!target) {
          throw new NotFoundException(
            'Group member not found',
          );
        }

        const activeUser = await tx.user.findFirst({
          where: {
            id: targetId,
            status: 'ACTIVE',
          },
          select: { id: true },
        });

        if (!activeUser) {
          throw new ForbiddenException(
            'Target user is not active',
          );
        }

        await tx.conversationMember.update({
          where: { id: actor.id },
          data: { role: 'ADMIN' },
        });

        await tx.conversationMember.update({
          where: { id: target.id },
          data: { role: 'OWNER' },
        });

        const targetName = await this.systemMessages.displayName(tx, targetId);

        return this.systemMessages.create(
          tx,
          conversationId,
          userId,
          `${targetName} został właścicielem grupy.`,
        );
      },
    );

    this.emit(
      GROUP_EVENTS.OWNER_TRANSFERRED,
      conversationId,
      userId,
      [userId, targetId],
    );

    await this.systemMessages.publish(message);

    return { success: true };
  }

  async leave(
    userId: string,
    conversationId: string,
  ) {
    conversationId = conversationId.toLowerCase();

    const message = await socialTransaction(
      this.prisma,
      async tx => {
        const { actor } = await this.requireGroup(
          tx,
          conversationId,
          userId,
        );

        if (actor.role === 'OWNER') {
          throw new ConflictException(
            'Transfer ownership before leaving',
          );
        }

        await tx.conversationMember.update({
          where: { id: actor.id },
          data: {
            leftAt: new Date(),
            role: 'MEMBER',
          },
        });

        const actorName = await this.systemMessages.displayName(tx, userId);

        return this.systemMessages.create(
          tx,
          conversationId,
          userId,
          `${actorName} opuścił grupę.`,
        );
      },
    );

    this.emit(
      GROUP_EVENTS.MEMBER_REMOVED,
      conversationId,
      userId,
      [userId],
    );

    await this.systemMessages.publish(message);

    return { success: true };
  }
}
