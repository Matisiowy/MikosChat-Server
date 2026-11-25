import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { socialTransaction } from '../common/social-transaction';

@Injectable()
export class ReceiptsService {
  private readonly logger = new Logger(ReceiptsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async delivered(userId: string, messageId: string) {
    return this.updateReceipt(userId, messageId, false);
  }

  async read(userId: string, messageId: string) {
    return this.updateReceipt(userId, messageId, true);
  }

  private async updateReceipt(
    userId: string,
    messageId: string,
    read: boolean,
  ) {
    messageId = messageId.toLowerCase();

    const result = await socialTransaction(
      this.prisma,
      async tx => {
        const message = await tx.message.findFirst({
          where: {
            id: messageId,
            deletedAt: null,
            conversation: {
              members: {
                some: {
                  userId,
                  leftAt: null,
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

        if (!message || message.senderId === userId) {
          throw new NotFoundException('Receipt not found');
        }

        const receipt = await tx.messageReceipt.findUnique({
          where: {
            messageId_userId: {
              messageId,
              userId,
            },
          },
        });

        if (!receipt) {
          throw new NotFoundException('Receipt not found');
        }

        const now = new Date();

        const changed =
          !receipt.deliveredAt ||
          (read && !receipt.readAt);

        if (!changed) {
          return {
            changed: false,
            receipt,
            conversationId: message.conversationId,
            senderId: message.senderId,
          };
        }

        const updated = await tx.messageReceipt.update({
          where: {
            messageId_userId: {
              messageId,
              userId,
            },
          },
          data: {
            deliveredAt: receipt.deliveredAt ?? now,
            readAt: read
              ? receipt.readAt ?? now
              : receipt.readAt,
          },
        });

        return {
          changed: true,
          receipt: updated,
          conversationId: message.conversationId,
          senderId: message.senderId,
        };
      },
    );

    if (result.changed) {
      try {
        await this.events.emitAsync(
          'receipt.updated',
          {
            ...result.receipt,
            conversationId: result.conversationId,
            senderId: result.senderId,
          },
        );
      } catch {
        this.logger.warn('Receipt event delivery failed');
      }
    }

    return result.receipt;
  }
}
