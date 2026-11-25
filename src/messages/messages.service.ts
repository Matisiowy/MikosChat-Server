import { serializeMessage } from '../attachments/attachment.serializer';
import type { PreparedAttachment } from '../attachments/attachments.config';
import type { SendAttachmentsDto } from '../attachments/dto/send-attachments.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MESSAGE_EVENTS } from './events/message.events';
import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { socialTransaction } from '../common/social-transaction';
import { SendMessageDto } from './dto/send-message.dto';
import { MessageHistoryDto } from './dto/message-history.dto';
import { SearchMessagesDto } from './dto/search-messages.dto';
import { messageInclude } from './message-select';

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly events: EventEmitter2,
  ) {}

  private async requireWriteAccess(
    tx: Prisma.TransactionClient,
    userId: string,
    conversationId: string,
  ) {
    await this.conversations.requireMembership(
      userId,
      conversationId,
      tx,
    );

    const conversation = await tx.conversation.findUnique({
      where: { id: conversationId },
      include: {
        members: {
          where: { leftAt: null },
          include: {
            user: {
              select: { status: true },
            },
          },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const otherIds = conversation.members
      .filter(m => m.userId !== userId)
      .map(m => m.userId);

    if (
      conversation.type === 'DIRECT' &&
      (
        otherIds.length !== 1 ||
        conversation.members.some(
          m => m.user.status !== 'ACTIVE',
        )
      )
    ) {
      throw new ForbiddenException(
        'Conversation unavailable',
      );
    }

    const block = await tx.block.findFirst({
      where: {
        OR: [
          {
            blockerId: userId,
            blockedId: { in: otherIds },
          },
          {
            blockerId: { in: otherIds },
            blockedId: userId,
          },
        ],
      },
    });

    if (block) {
      throw new ForbiddenException(
        'Messaging unavailable in this conversation',
      );
    }

    return conversation;
  }

  async send(
    userId: string,
    conversationId: string,
    dto: SendMessageDto,
  ) {
    conversationId = conversationId.toLowerCase();

    const result = await socialTransaction(this.prisma, async tx => {
      const conversation = await this.requireWriteAccess(
        tx,
        userId,
        conversationId,
      );

      const clientMessageId =
        dto.clientMessageId.toLowerCase();

      const existing = await tx.message.findUnique({
        where: {
          senderId_clientMessageId: {
            senderId: userId,
            clientMessageId,
          },
        },
        include: messageInclude,
      });

      if (existing) {
        if (existing.conversationId !== conversationId) {
          throw new ConflictException(
            'Client message ID already used',
          );
        }

        return { message: existing, created: false };
      }

      if (dto.replyToId) {
        const reply = await tx.message.findFirst({
          where: {
            id: dto.replyToId,
            conversationId,
            deletedAt: null,
          },
        });

        if (!reply) {
          throw new BadRequestException(
            'Invalid reply message',
          );
        }
      }

      const recipients = conversation.members
        .filter(m => m.userId !== userId)
        .map(m => ({
          userId: m.userId,
        }));

      const message = await tx.message.create({
        data: {
          clientMessageId,
          conversationId,
          senderId: userId,
          type: 'TEXT',
          content: dto.content.trim(),
          replyToId: dto.replyToId,
          receipts: {
            create: recipients,
          },
        },
        include: messageInclude,
      });

      await tx.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });

      return { message, created: true };
    });

    if (result.created) {
      await this.publish(
        MESSAGE_EVENTS.CREATED,
        serializeMessage(result.message),
      );
    }

    return serializeMessage(result.message);
  }

  async authorizeAttachmentUpload(
    userId: string,
    conversationId: string,
  ) {
    await socialTransaction(this.prisma, async tx => {
      await this.requireWriteAccess(
        tx,
        userId,
        conversationId.toLowerCase(),
      );
    });
  }

  async sendAttachments(
    userId: string,
    conversationId: string,
    dto: SendAttachmentsDto,
    attachments: PreparedAttachment[],
  ) {
    conversationId = conversationId.toLowerCase();

    if (
      attachments.length === 0 ||
      attachments.length > 5
    ) {
      throw new BadRequestException(
        'Between 1 and 5 attachments are required',
      );
    }

    const result = await socialTransaction(
      this.prisma,
      async tx => {
        const conversation = await this.requireWriteAccess(
          tx,
          userId,
          conversationId,
        );

        const clientMessageId =
          dto.clientMessageId.toLowerCase();

        const existing = await tx.message.findUnique({
          where: {
            senderId_clientMessageId: {
              senderId: userId,
              clientMessageId,
            },
          },
          include: messageInclude,
        });

        if (existing) {
          if (
            existing.conversationId !== conversationId
          ) {
            throw new ConflictException(
              'Client message ID already used',
            );
          }

          return {
            message: existing,
            created: false,
          };
        }

        if (dto.replyToId) {
          const reply = await tx.message.findFirst({
            where: {
              id: dto.replyToId,
              conversationId,
              deletedAt: null,
            },
          });

          if (!reply) {
            throw new BadRequestException(
              'Invalid reply message',
            );
          }
        }

        const recipients = conversation.members
          .filter(member => member.userId !== userId)
          .map(member => ({
            userId: member.userId,
          }));

        let type: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE' =
          'FILE';

        if (
          attachments.every(
            file => file.mimeType.startsWith('image/'),
          )
        ) {
          type = 'IMAGE';
        } else if (
          attachments.every(
            file => file.mimeType.startsWith('video/'),
          )
        ) {
          type = 'VIDEO';
        } else if (
          attachments.every(
            file => file.mimeType.startsWith('audio/'),
          )
        ) {
          type = 'AUDIO';
        }

        const message = await tx.message.create({
          data: {
            clientMessageId,
            conversationId,
            senderId: userId,
            type,
            content: dto.content?.trim() || null,
            replyToId: dto.replyToId,
            attachments: {
              create: attachments,
            },
            receipts: {
              create: recipients,
            },
          },
          include: messageInclude,
        });

        await tx.conversation.update({
          where: { id: conversationId },
          data: {
            updatedAt: new Date(),
          },
        });

        return {
          message,
          created: true,
        };
      },
    );

    const message = serializeMessage(result.message);

    if (result.created) {
      await this.publish(
        MESSAGE_EVENTS.CREATED,
        message,
      );
    }

    return {
      message,
      created: result.created,
    };
  }

  async search(
    userId: string,
    conversationId: string,
    dto: SearchMessagesDto,
  ) {
    return socialTransaction(this.prisma, async tx => {
      await this.conversations.requireMembership(
        userId,
        conversationId,
        tx,
      );

      const limit = dto.limit ?? 30;

      const query = dto.q
        .trim()
        .replace(/[\\%_]/g, '\\$&');

      const messages = await tx.message.findMany({
        where: {
          conversationId,
          deletedAt: null,
          type: { not: 'SYSTEM' },
          content: {
            contains: query,
            mode: 'insensitive',
          },
        },
        include: messageInclude,
        orderBy: [
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        take: limit + 1,
      });

      return {
        items: messages
          .slice(0, limit)
          .map(serializeMessage),
        hasMore: messages.length > limit,
      };
    });
  }

  async history(
    userId: string,
    conversationId: string,
    dto: MessageHistoryDto,
  ) {
    return socialTransaction(this.prisma, async tx => {
      await this.conversations.requireMembership(
        userId,
        conversationId,
        tx,
      );

      const limit = dto.limit ?? 50;

      if (dto.cursor) {
        const cursor = await tx.message.findFirst({
          where: {
            id: dto.cursor,
            conversationId,
          },
          select: { id: true },
        });

        if (!cursor) {
          throw new BadRequestException(
            'Invalid message cursor',
          );
        }
      }

      const messages = await tx.message.findMany({
        where: { conversationId },
        include: messageInclude,
        orderBy: [
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        take: limit + 1,
        ...(dto.cursor
          ? {
              cursor: { id: dto.cursor },
              skip: 1,
            }
          : {}),
      });

      const hasMore = messages.length > limit;
      const items = messages.slice(0, limit);

      return {
        items: items.reverse().map(serializeMessage),
        hasMore,
        nextCursor: hasMore
          ? items[0]?.id ?? null
          : null,
      };
    });
  }

  async edit(
    userId: string,
    messageId: string,
    content: string,
  ) {
    const updated = await socialTransaction(this.prisma, async tx => {
      const message = await tx.message.findFirst({
        where: {
          id: messageId,
          senderId: userId,
          deletedAt: null,
          type: 'TEXT',
        },
      });

      if (!message) {
        throw new NotFoundException(
          'Message not found',
        );
      }

      await this.requireWriteAccess(
        tx,
        userId,
        message.conversationId,
      );

      return tx.message.update({
        where: { id: messageId },
        data: {
          content: content.trim(),
          editedAt: new Date(),
        },
        include: messageInclude,
      });
    });

    await this.publish(
      MESSAGE_EVENTS.UPDATED,
      serializeMessage(updated),
    );

    return serializeMessage(updated);
  }

  async remove(userId: string, messageId: string) {
    const deleted = await socialTransaction(this.prisma, async tx => {
      const message = await tx.message.findFirst({
        where: {
          id: messageId,
          senderId: userId,
          type: { not: 'SYSTEM' },
        },
      });

      if (!message) {
        throw new NotFoundException(
          'Message not found',
        );
      }

      await this.conversations.requireMembership(
        userId,
        message.conversationId,
        tx,
      );

      if (message.deletedAt) {
        return null;
      }

      await tx.reaction.deleteMany({
        where: { messageId },
      });

      const updated = await tx.message.update({
        where: { id: messageId },
        data: {
          content: null,
          deletedAt: new Date(),
        },
      });

      return {
        id: updated.id,
        conversationId: updated.conversationId,
        senderId: updated.senderId,
        deletedAt: updated.deletedAt,
      };
    });

    if (deleted) {
      await this.publish(
        MESSAGE_EVENTS.DELETED,
        deleted,
      );
    }

    return { success: true };
  }

  private async publish(event: string, payload: unknown) {
    try {
      await this.events.emitAsync(event, payload);
    } catch {
      this.logger.warn(`Event delivery failed: ${event}`);
    }
  }

}
