import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

@Injectable()
export class AvatarsService {
  private readonly logger = new Logger('AvatarsService');
  private readonly directory: string;
  private readonly prefix = '/api/v1/media/avatars/';

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.directory = join(
      config.getOrThrow<string>('STORAGE_PATH'),
      'avatars',
    );
  }

  private validFilename(filename: string) {
    return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.webp$/.test(filename);
  }

  getPath(filename: string) {
    if (!this.validFilename(filename)) {
      throw new NotFoundException('Avatar not found');
    }

    return join(this.directory, filename);
  }

  private async cleanup(url: string | null) {
    if (!url?.startsWith(this.prefix)) return;

    const filename = url.slice(this.prefix.length);

    if (!this.validFilename(filename)) return;

    try {
      await unlink(this.getPath(filename));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn('Avatar cleanup failed');
      }
    }
  }

  async upload(userId: string, file?: Express.Multer.File) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Image is required');
    }

    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('Maximum image size is 5 MB');
    }

    let image: Buffer;

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
        throw new Error('Unsupported format');
      }

      if ((metadata.pages ?? 1) > 1) {
        throw new Error('Animated images are unsupported');
      }

      image = await pipeline
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

    let oldUrl: string | null;

    try {
      oldUrl = await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`
          SELECT id FROM users
          WHERE id = ${userId}::uuid
          FOR UPDATE
        `;

        const user = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { avatarUrl: true },
        });

        await tx.user.update({
          where: { id: userId },
          data: { avatarUrl },
        });

        return user.avatarUrl;
      });
    } catch (error) {
      await this.cleanup(avatarUrl);
      throw error;
    }

    await this.cleanup(oldUrl);

    return { avatarUrl };
  }

  async remove(userId: string) {
    const oldUrl = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`
        SELECT id FROM users
        WHERE id = ${userId}::uuid
        FOR UPDATE
      `;

      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { avatarUrl: true },
      });

      await tx.user.update({
        where: { id: userId },
        data: { avatarUrl: null },
      });

      return user.avatarUrl;
    });

    await this.cleanup(oldUrl);

    return { avatarUrl: null };
  }
}
