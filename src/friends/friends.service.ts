import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { publicProfileSelect } from '../common/user-select';
import {
  pairKey,
  socialTransaction,
} from '../common/social-transaction';

@Injectable()
export class FriendsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const friendships = await this.prisma.friendship.findMany({
      where: {
        status: 'ACCEPTED',
        OR: [
          { senderId: userId, receiver: { status: 'ACTIVE' } },
          { receiverId: userId, sender: { status: 'ACTIVE' } },
        ],
      },
      include: {
        sender: { select: publicProfileSelect },
        receiver: { select: publicProfileSelect },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });

    return friendships.map((friendship) => ({
      id: friendship.id,
      since: friendship.updatedAt,
      user:
        friendship.senderId === userId
          ? friendship.receiver
          : friendship.sender,
    }));
  }

  async requests(userId: string) {
    const requests = await this.prisma.friendship.findMany({
      where: {
        status: 'PENDING',
        sender: { status: 'ACTIVE' },
        receiver: { status: 'ACTIVE' },
        OR: [
          { senderId: userId },
          { receiverId: userId },
        ],
      },
      include: {
        sender: { select: publicProfileSelect },
        receiver: { select: publicProfileSelect },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return {
      incoming: requests.filter(
        (request) => request.receiverId === userId,
      ),
      outgoing: requests.filter(
        (request) => request.senderId === userId,
      ),
    };
  }

  async request(senderId: string, receiverId: string) {
    if (senderId === receiverId) {
      throw new BadRequestException(
        'You cannot add yourself',
      );
    }

    try {
      return await socialTransaction(this.prisma, async (tx) => {
        const receiver = await tx.user.findFirst({
          where: {
            id: receiverId,
            status: 'ACTIVE',
          },
          select: { id: true },
        });

        if (!receiver) {
          throw new NotFoundException('User not found');
        }

        const block = await tx.block.findFirst({
          where: {
            OR: [
              { blockerId: senderId, blockedId: receiverId },
              { blockerId: receiverId, blockedId: senderId },
            ],
          },
        });

        if (block) {
          throw new NotFoundException('User not found');
        }

        const key = pairKey(senderId, receiverId);

        const existing = await tx.friendship.findUnique({
          where: { pairKey: key },
        });

        if (existing) {
          throw new ConflictException(
            'Friendship or request already exists',
          );
        }

        return tx.friendship.create({
          data: {
            senderId,
            receiverId,
            pairKey: key,
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Friendship or request already exists',
        );
      }

      throw error;
    }
  }

  async accept(userId: string, friendshipId: string) {
    return socialTransaction(this.prisma, async (tx) => {
      const result = await tx.friendship.updateMany({
        where: {
          id: friendshipId,
          receiverId: userId,
          status: 'PENDING',
          sender: { status: 'ACTIVE' },
        },
        data: { status: 'ACCEPTED' },
      });

      if (result.count !== 1) {
        throw new NotFoundException('Request not found');
      }

      return { success: true, status: 'ACCEPTED' };
    });
  }

  async reject(userId: string, friendshipId: string) {
    const result = await this.prisma.friendship.updateMany({
      where: {
        id: friendshipId,
        receiverId: userId,
        status: 'PENDING',
      },
      data: { status: 'REJECTED' },
    });

    if (result.count !== 1) {
      throw new NotFoundException('Request not found');
    }

    return { success: true, status: 'REJECTED' };
  }

  async remove(userId: string, friendshipId: string) {
    const result = await this.prisma.friendship.deleteMany({
      where: {
        id: friendshipId,
        OR: [
          { senderId: userId, status: 'PENDING' },
          { senderId: userId, status: 'ACCEPTED' },
          { receiverId: userId, status: 'ACCEPTED' },
        ],
      },
    });

    if (result.count !== 1) {
      throw new NotFoundException('Friendship not found');
    }

    return { success: true };
  }
}
