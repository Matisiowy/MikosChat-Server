import { Prisma } from '@prisma/client';
import { publicProfileSelect } from '../common/user-select';

export const conversationInclude = {
  members: {
    where: {
      leftAt: null,
    },
    select: {
      id: true,
      userId: true,
      conversationId: true,
      role: true,
      nickname: true,
      joinedAt: true,
      user: {
        select: publicProfileSelect,
      },
    },
  },
  messages: {
    orderBy: [
      { createdAt: 'desc' },
      { id: 'desc' },
    ],
    take: 1,
    select: {
      id: true,
      senderId: true,
      type: true,
      content: true,
      createdAt: true,
      deletedAt: true,
    },
  },
} satisfies Prisma.ConversationInclude;
