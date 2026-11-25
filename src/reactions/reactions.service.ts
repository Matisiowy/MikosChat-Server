import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { socialTransaction } from '../common/social-transaction';

@Injectable()
export class ReactionsService {
  private readonly logger = new Logger(ReactionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async set(userId: string, messageId: string, emoji: string) {
    return this.update(userId, messageId, emoji);
  }

  async remove(userId: string, messageId: string) {
    return this.update(userId, messageId, null);
  }

  private async update(
    userId: string,
    messageId: string,
    emoji: string | null,
  ) {
    messageId = messageId.toLowerCase();

    const result = await socialTransaction(
      this.prisma,
      async tx => {
        const message = await tx.message.findFirst({
          where: {
            id: messageId,
            deletedAt: null,
            type: { not: 'SYSTEM' },
            conversation: {
              members: {
                some: {
                  userId,
                  leftAt: null,
                  user: { status: 'ACTIVE' },
                },
              },
            },
          },
          select: {
            id: true,
            senderId: true,
            conversationId: true,
          },
        });

        if (!message) {
          throw new NotFoundException('Message not found');
        }

        if (emoji !== null) {
          const block = await tx.block.findFirst({
            where: {
              OR: [
                {
                  blockerId: userId,
                  blockedId: message.senderId,
                },
                {
                  blockerId: message.senderId,
                  blockedId: userId,
                },
              ],
            },
          });

          if (block) {
            throw new ForbiddenException('Reaction unavailable');
          }
        }

        const existing = await tx.reaction.findMany({
          where: { messageId, userId },
        });

        const unchanged = emoji === null
          ? existing.length === 0
          : existing.length === 1 &&
            existing[0].emoji === emoji;

        if (!unchanged) {
          await tx.reaction.deleteMany({
            where: { messageId, userId },
          });

          if (emoji !== null) {
            await tx.reaction.create({
              data: {
                messageId,
                userId,
                emoji,
              },
            });
          }
        }

        const reactions = await tx.reaction.findMany({
          where: { messageId },
          orderBy: [
            { createdAt: 'asc' },
            { id: 'asc' },
          ],
        });

        return {
          changed: !unchanged,
          payload: {
            messageId,
            conversationId: message.conversationId,
            userId,
            reactions,
          },
        };
      },
    );

    if (result.changed) {
      try {
        await this.events.emitAsync(
          'reaction.updated',
          result.payload,
        );
      } catch {
        this.logger.warn('Reaction event delivery failed');
      }
    }

    return result.payload;
  }
}
