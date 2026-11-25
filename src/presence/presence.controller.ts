import {
  Controller,
  Get,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthRequest } from '../common/auth-request';
import { PresenceService } from './presence.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Presence')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('presence')
export class PresenceController {
  constructor(
    private readonly presence: PresenceService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('friends')
  async getFriendsPresence(@Req() req: AuthRequest) {
    const userId = req.user.userId;

    const friendships = await this.prisma.friendship.findMany({
      where: {
        status: 'ACCEPTED',
        OR: [
          { senderId: userId },
          { receiverId: userId },
        ],
      },
      select: {
        senderId: true,
        receiverId: true,
      },
    });

    const friendIds = friendships.map(f =>
      f.senderId === userId
        ? f.receiverId
        : f.senderId,
    );

    const users = await this.prisma.user.findMany({
      where: {
        id: { in: friendIds },
        status: 'ACTIVE',
        blockedUsers: {
          none: { blockedId: userId },
        },
        blockedBy: {
          none: { blockerId: userId },
        },
      },
      select: {
        id: true,
        lastSeenAt: true,
      },
    });

    return Promise.all(
      users.map(async user => {
        const online = await this.presence.isOnline(user.id);

        return {
          userId: user.id,
          online,
          lastSeenAt: online ? null : user.lastSeenAt,
        };
      }),
    );
  }
}
