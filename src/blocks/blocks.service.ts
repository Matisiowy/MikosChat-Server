import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { publicProfileSelect } from '../common/user-select';
import {
  pairKey,
  socialTransaction,
} from '../common/social-transaction';

@Injectable()
export class BlocksService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    return this.prisma.block.findMany({
      where: { blockerId: userId },
      select: {
        id: true,
        createdAt: true,
        blocked: {
          select: publicProfileSelect,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async block(userId: string, targetId: string) {
    if (userId === targetId) {
      throw new BadRequestException(
        'You cannot block yourself',
      );
    }

    return socialTransaction(this.prisma, async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: targetId },
        select: { id: true },
      });

      if (!target) {
        throw new NotFoundException('User not found');
      }

      await tx.block.upsert({
        where: {
          blockerId_blockedId: {
            blockerId: userId,
            blockedId: targetId,
          },
        },
        update: {},
        create: {
          blockerId: userId,
          blockedId: targetId,
        },
      });

      await tx.friendship.deleteMany({
        where: {
          pairKey: pairKey(userId, targetId),
        },
      });

      return { success: true };
    });
  }

  async unblock(userId: string, targetId: string) {
    await this.prisma.block.deleteMany({
      where: {
        blockerId: userId,
        blockedId: targetId,
      },
    });

    return { success: true };
  }
}
