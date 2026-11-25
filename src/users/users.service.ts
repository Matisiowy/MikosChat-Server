import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { publicProfileSelect } from '../common/user-select';
import { SearchUsersDto } from './dto/search-users.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async search(userId: string, dto: SearchUsersDto) {
    const query = dto.q.trim();

    if (query.length < 2) {
      throw new BadRequestException('Query is too short');
    }

    return this.prisma.user.findMany({
      where: {
        id: { not: userId },
        status: 'ACTIVE',
        OR: [
          {
            username: {
              contains: query,
              mode: 'insensitive',
            },
          },
          {
            displayName: {
              contains: query,
              mode: 'insensitive',
            },
          },
        ],
        blockedUsers: {
          none: { blockedId: userId },
        },
        blockedBy: {
          none: { blockerId: userId },
        },
      },
      select: publicProfileSelect,
      orderBy: [
        { username: 'asc' },
        { id: 'asc' },
      ],
      take: dto.limit,
      skip: dto.offset,
    });
  }

  async getProfile(viewerId: string, targetId: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: targetId,
        status: 'ACTIVE',
        blockedUsers: {
          none: { blockedId: viewerId },
        },
        blockedBy: {
          none: { blockerId: viewerId },
        },
      },
      select: publicProfileSelect,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        displayName: dto.displayName?.trim(),
        bio: dto.bio?.trim(),
      },
      select: publicProfileSelect,
    });
  }
}
