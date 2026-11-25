import type { Prisma } from '@prisma/client';
import type { messageInclude } from '../message-select';
import type {
  serializeMessage,
} from '../../attachments/attachment.serializer';

export type RawMessagePayload = Prisma.MessageGetPayload<{
  include: typeof messageInclude;
}>;

export type MessagePayload = ReturnType<
  typeof serializeMessage<RawMessagePayload>
>;

export const MESSAGE_EVENTS = {
  CREATED: 'message.created',
  UPDATED: 'message.updated',
  DELETED: 'message.deleted',
} as const;

export interface MessageDeletedEvent {
  id: string;
  conversationId: string;
  senderId: string;
  deletedAt: Date;
}
