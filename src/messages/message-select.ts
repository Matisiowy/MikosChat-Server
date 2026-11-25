import { Prisma } from '@prisma/client';
import { publicProfileSelect } from '../common/user-select';

export const messageInclude = {
  sender: {
    select: publicProfileSelect,
  },
  replyTo: {
    select: {
      id: true,
      senderId: true,
      content: true,
      type: true,
      deletedAt: true,
    },
  },
  receipts: true,
  reactions: true,
  attachments: {
    orderBy: [
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
  },
} satisfies Prisma.MessageInclude;
