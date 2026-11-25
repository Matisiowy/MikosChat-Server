import {
  Injectable,
  Logger,
} from '@nestjs/common';

import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { messageInclude } from '../messages/message-select';
import { MESSAGE_EVENTS } from '../messages/events/message.events';
import { serializeMessage } from '../attachments/attachment.serializer';

@Injectable()
export class SystemMessagesService {
  private readonly logger = new Logger(
    SystemMessagesService.name,
  );

  constructor(
    private readonly events: EventEmitter2,
  ) {}

  async create(
    tx: Prisma.TransactionClient,
    conversationId: string,
    actorId: string,
    content: string,
  ) {
    const message = await tx.message.create({
      data: {
        clientMessageId: randomUUID(),
        conversationId,
        senderId: actorId,
        type: 'SYSTEM',
        content,
      },
      include: messageInclude,
    });

    await tx.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    return serializeMessage(message);
  }

  async displayName(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<string> {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });

    return user?.displayName ?? 'Użytkownik';
  }

  async publish(message: unknown) {
    try {
      await this.events.emitAsync(
        MESSAGE_EVENTS.CREATED,
        message,
      );
    } catch {
      this.logger.warn(
        'System message event delivery failed',
      );
    }
  }
}
