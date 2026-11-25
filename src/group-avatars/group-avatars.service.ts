import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';

import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink, open } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

import { PrismaService } from '../prisma/prisma.service';
import { socialTransaction } from '../common/social-transaction';
import { GROUP_EVENTS } from '../groups/events/group.events';
import { SystemMessagesService } from '../system-messages/system-messages.service';

@Injectable()
export class GroupAvatarsService {
  private readonly logger = new Logger(GroupAvatarsService.name);
  private readonly directory: string;
  private readonly prefix = '/api/v1/media/group-avatars/';

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly systemMessages: SystemMessagesService,
    config: ConfigService,
  ) {
    this.directory = join(
      config.getOrThrow<string>('STORAGE_PATH'),
      'group-avatars',
    );
  }

  private validFilename(filename: string) {
    return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.webp$/.test(filename);
  }

  private getPath(filename: string) {
    if (!this.validFilename(filename)) {
      throw new NotFoundException('Avatar not found');
    }

    return join(this.directory, filename);
  }

  private async requireManager(
    tx: Prisma.TransactionClient,
    userId: string,
    conversationId: string,
  ) {
    const group = await tx.conversation.findFirst({
      where: {
        id: conversationId,
        type: 'GROUP',
        members: {
          some: {
            userId,
            leftAt: null,
          },
        },
      },
      include: {
        members: {
          where: {
            userId,
            leftAt: null,
          },
        },
      },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    const role = group.members[0]?.role;

    if (role !== 'OWNER' && role !== 'ADMIN') {
      throw new ForbiddenException(
        'Group administrator permissions required',
      );
    }

    return group;
  }

  private async cleanup(url: string | null) {
    if (!url?.startsWith(this.prefix)) return;

    const filename = url.slice(this.prefix.length);

    if (!this.validFilename(filename)) return;

    try {
      await unlink(this.getPath(filename));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn('Group avatar cleanup failed');
      }
    }
  }

  private async processImage(file?: Express.Multer.File) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Image is required');
    }

    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('Maximum image size is 5 MB');
    }

    try {
      const pipeline = sharp(file.buffer, {
        limitInputPixels: 25_000_000,
        failOn: 'error',
      });

      const metadata = await pipeline.metadata();

      if (
        !metadata.format ||
        !['jpeg', 'png', 'webp'].includes(metadata.format)
      ) {
        throw new Error('Unsupported image format');
      }

      if ((metadata.pages ?? 1) > 1) {
        throw new Error('Animated images are unsupported');
      }

      return await pipeline
        .rotate()
        .resize(512, 512, {
          fit: 'cover',
          position: 'centre',
        })
        .webp({ quality: 85 })
        .toBuffer();

    } catch {
      throw new BadRequestException(
        'Invalid or unsupported image',
      );
    }
  }

  private notify(conversationId: string, actorId: string) {
    this.events.emit(GROUP_EVENTS.UPDATED, {
      conversationId,
      actorId,
      affectedUserIds: [],
    });
  }

  async upload(
    userId: string,
    conversationId: string,
    file?: Express.Multer.File,
  ) {
    conversationId = conversationId.toLowerCase();

    await this.requireManager(
      this.prisma,
      userId,
      conversationId,
    );

    const image = await this.processImage(file);

    await mkdir(this.directory, {
      recursive: true,
      mode: 0o750,
    });

    const filename = `${randomUUID()}.webp`;
    const avatarUrl = this.prefix + filename;

    await writeFile(this.getPath(filename), image, {
      flag: 'wx',
      mode: 0o640,
    });

    const result = await socialTransaction(
      this.prisma,
      async tx => {
        const group = await this.requireManager(
          tx,
          userId,
          conversationId,
        );

        await tx.conversation.update({
          where: { id: conversationId },
          data: { avatarUrl },
        });

        const actorName =
          await this.systemMessages.displayName(tx, userId);

        const message = await this.systemMessages.create(
          tx,
          conversationId,
          userId,
          `${actorName} zmienił zdjęcie grupy.`,
        );

        return {
          oldUrl: group.avatarUrl,
          message,
        };
      },
    ).catch(async error => {
      await this.cleanup(avatarUrl);
      throw error;
    });

    await this.cleanup(result.oldUrl);

    this.notify(conversationId, userId);

    await this.systemMessages.publish(result.message);

    return { avatarUrl };
  }

  async remove(userId: string, conversationId: string) {
    conversationId = conversationId.toLowerCase();

    const result = await socialTransaction(
      this.prisma,
      async tx => {
        const group = await this.requireManager(
          tx,
          userId,
          conversationId,
        );

        if (!group.avatarUrl) {
          return null;
        }

        await tx.conversation.update({
          where: { id: conversationId },
          data: { avatarUrl: null },
        });

        const actorName =
          await this.systemMessages.displayName(tx, userId);

        const message = await this.systemMessages.create(
          tx,
          conversationId,
          userId,
          `${actorName} usunął zdjęcie grupy.`,
        );

        return {
          oldUrl: group.avatarUrl,
          message,
        };
      },
    );

    if (result) {
      await this.cleanup(result.oldUrl);

      this.notify(conversationId, userId);

      await this.systemMessages.publish(result.message);
    }

    return { avatarUrl: null };
  }

  async download(userId: string, filename: string) {
    const path = this.getPath(filename);

    const group = await this.prisma.conversation.findFirst({
      where: {
        type: 'GROUP',
        avatarUrl: this.prefix + filename,
        members: {
          some: {
            userId,
            leftAt: null,
          },
        },
      },
      select: { id: true },
    });

    if (!group) {
      throw new NotFoundException('Avatar not found');
    }

    try {
      return await open(path, 'r');
    } catch {
      throw new NotFoundException('Avatar not found');
    }
  }
}
