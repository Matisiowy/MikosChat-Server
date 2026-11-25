import { Prisma } from '@prisma/client';

export const publicProfileSelect = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  bio: true,
  createdAt: true,
} satisfies Prisma.UserSelect;
