import { SystemMessagesService } from '../system-messages/system-messages.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  pairKey,
  socialTransaction,
} from '../common/social-transaction';
import { conversationInclude } from './conversation-select';

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly systemMessages: SystemMessagesService,
  ) {}

  async createDirect(userId: string, targetId: string) {
    targetId = targetId.toLowerCase();

    if (userId === targetId) {
      throw new BadRequestException(
        'Cannot create a conversation with yourself',
      );
    }

    const key = pairKey(userId, targetId);

    try {
      return await socialTransaction(this.prisma, async (tx) => {
        const target = await tx.user.findFirst({
          where: {
            id: targetId,
            status: 'ACTIVE',
          },
          select: { id: true },
        });

        if (!target) {
          throw new NotFoundException('User not found');
        }

        const block = await tx.block.findFirst({
          where: {
            OR: [
              { blockerId: userId, blockedId: targetId },
              { blockerId: targetId, blockedId: userId },
            ],
          },
        });

        if (block) {
          throw new NotFoundException('User not found');
        }

        const existing = await tx.conversation.findUnique({
          where: { directKey: key },
          include: conversationInclude,
        });

        if (existing) {
          return existing;
        }

        const friendship = await tx.friendship.findUnique({
          where: { pairKey: key },
        });

        if (friendship?.status !== 'ACCEPTED') {
          throw new ForbiddenException(
            'Only friends can start a direct conversation',
          );
        }

        return tx.conversation.create({
          data: {
            type: 'DIRECT',
            directKey: key,
            createdById: userId,
            members: {
              create: [
                { userId, role: 'MEMBER' },
                { userId: targetId, role: 'MEMBER' },
              ],
            },
          },
          include: conversationInclude,
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(
          'Conversation already created. Please retry.',
        );
      }

      throw error;
    }
  }

  async createGroup(
    userId: string,
    name: string,
    memberIds: string[],
  ) {
    const ids = [...new Set(
      memberIds.map(id => id.toLowerCase())
    )].filter(id => id !== userId);

    if (ids.length < 2) {
      throw new BadRequestException(
        'Group requires at least 3 members',
      );
    }

    const result = await socialTransaction(this.prisma, async (tx) => {
      const users = await tx.user.findMany({
        where: {
          id: { in: ids },
          status: 'ACTIVE',
        },
        select: { id: true },
      });

      if (users.length !== ids.length) {
        throw new NotFoundException(
          'One or more users were not found',
        );
      }

      const allIds = [userId, ...ids];

      const block = await tx.block.findFirst({
        where: {
          blockerId: { in: allIds },
          blockedId: { in: allIds },
        },
      });

      if (block) {
        throw new ForbiddenException(
          'Cannot create this group',
        );
      }

      const friendships = await tx.friendship.count({
        where: {
          status: 'ACCEPTED',
          pairKey: {
            in: ids.map(id => pairKey(userId, id)),
          },
        },
      });

      if (friendships !== ids.length) {
        throw new ForbiddenException(
          'You can only invite your friends',
        );
      }

      const conversation = await tx.conversation.create({
        data: {
          type: 'GROUP',
          name: name.trim(),
          createdById: userId,
          members: {
            create: [
              { userId, role: 'OWNER' },
              ...ids.map(id => ({
                userId: id,
                role: 'MEMBER' as const,
              })),
            ],
          },
        },
        include: conversationInclude,
      });

      const actorName = await this.systemMessages.displayName(tx, userId);

      const message = await this.systemMessages.create(
        tx,
        conversation.id,
        userId,
        `${actorName} utworzył grupę.`,
      );

      const updatedConversation = await tx.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
        include: conversationInclude,
      });

      return {
        conversation: updatedConversation,
        message,
      };
    });

    const conversation = result.conversation;

    this.events.emit('group.created', {
      conversationId: conversation.id,
      actorId: userId,
      affectedUserIds: ids,
    });

    await this.systemMessages.publish(result.message);

    return conversation;
  }

  async list(userId: string) {
    return this.prisma.conversation.findMany({
      where: {
        members: {
          some: {
            userId,
            leftAt: null,
            archived: false,
          },
        },
      },
      include: conversationInclude,
      orderBy: [
        { updatedAt: 'desc' },
        { id: 'desc' },
      ],
      take: 100,
    });
  }

  async get(userId: string, conversationId: string) {
    const conversation =
      await this.prisma.conversation.findFirst({
        where: {
          id: conversationId,
          members: {
            some: {
              userId,
              leftAt: null,
            },
          },
        },
        include: conversationInclude,
      });

    if (!conversation) {
      throw new NotFoundException(
        'Conversation not found',
      );
    }

    return conversation;
  }

  async mute(
    userId: string,
    conversationId: string,
    duration: number,
  ) {
    conversationId = conversationId.toLowerCase();

    if (![15, 60, 480, 1440, -1].includes(duration)) {
      throw new BadRequestException('Invalid mute duration');
    }

    const mutedUntil = duration === -1
      ? new Date('9999-12-31T23:59:59.999Z')
      : new Date(Date.now() + duration * 60_000);

    return this.setMute(userId, conversationId, mutedUntil);
  }

  async unmute(userId: string, conversationId: string) {
    return this.setMute(
      userId,
      conversationId.toLowerCase(),
      null,
    );
  }

  private async setMute(
    userId: string,
    conversationId: string,
    mutedUntil: Date | null,
  ) {
    const result = await this.prisma.conversationMember.updateMany({
      where: {
        userId,
        conversationId,
        leftAt: null,
      },
      data: { mutedUntil },
    });

    if (result.count === 0) {
      throw new NotFoundException('Conversation not found');
    }

    const payload = {
      userId,
      conversationId,
      mutedUntil,
    };

    this.events.emit('conversation.mute.updated', payload);

    return {
      conversationId,
      mutedUntil,
    };
  }

  async requireMembership(
    userId: string,
    conversationId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const member =
      await tx.conversationMember.findFirst({
        where: {
          userId,
          conversationId,
          leftAt: null,
        },
      });

    if (!member) {
      throw new NotFoundException(
        'Conversation not found',
      );
    }

    return member;
  }
}
