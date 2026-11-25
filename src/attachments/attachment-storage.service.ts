import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  HttpException,
} from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import {
  mkdir,
  unlink,
  rename,
  readFile,
  statfs,
} from 'node:fs/promises';

import { join, basename, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

import {
  ATTACHMENT_LIMITS,
  ALLOWED_MIME_TYPES,
} from './attachments.config';

import type {
  PreparedAttachment,
} from './attachments.config';

@Injectable()
export class AttachmentStorageService {
  private readonly logger =
    new Logger(AttachmentStorageService.name);

  readonly directory: string;
  readonly temporaryDirectory: string;

  constructor(config: ConfigService) {
    const root = config.getOrThrow<string>('STORAGE_PATH');

    this.directory = resolve(root, 'attachments');
    this.temporaryDirectory = resolve(root, 'uploads');
  }

  async initialize() {
    await Promise.all([
      mkdir(this.directory, {
        recursive: true,
        mode: 0o750,
      }),
      mkdir(this.temporaryDirectory, {
        recursive: true,
        mode: 0o750,
      }),
    ]);
  }

  getPath(storageKey: string) {
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        storageKey,
      )
    ) {
      throw new NotFoundException('Attachment not found');
    }

    return join(this.directory, storageKey);
  }

  private cleanFilename(name: string) {
    return basename(name.replace(/\\/g, '/'))
      .replace(/[\x00-\x1f\x7f]/g, '')
      .replace(/[\u202a-\u202e\u2066-\u2069]/g, '')
      .trim()
      .slice(0, 180) || 'attachment';
  }

  async ensureFreeSpace(required: number) {
    const stats = await statfs(this.directory);
    const free = stats.bavail * stats.bsize;

    if (
      free - required <
      ATTACHMENT_LIMITS.minFreeSpace
    ) {
      throw new HttpException(
        'Insufficient storage space',
        507,
      );
    }
  }

  private async detectMime(file: Express.Multer.File) {
    const { fileTypeFromFile } = await import('file-type');

    const detected = await fileTypeFromFile(file.path);

    if (detected) {
      if (!ALLOWED_MIME_TYPES.has(detected.mime)) {
        throw new BadRequestException(
          'Unsupported file format',
        );
      }

      return detected.mime;
    }

    // Plain text requires separate validation.
    if (
      file.originalname.toLowerCase().endsWith('.txt') &&
      file.size <= 5 * 1024 * 1024
    ) {
      const buffer = await readFile(file.path);

      try {
        const text = new TextDecoder('utf-8', {
          fatal: true,
        }).decode(buffer);

        if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) {
          throw new Error('Binary content');
        }

        return 'text/plain';
      } catch {
        throw new BadRequestException(
          'Invalid text file',
        );
      }
    }

    throw new BadRequestException(
      'Unknown or unsupported file format',
    );
  }

  async prepare(
    file: Express.Multer.File,
  ): Promise<PreparedAttachment> {
    if (!file.size) {
      throw new BadRequestException('Empty file');
    }

    if (file.size > ATTACHMENT_LIMITS.maxFileSize) {
      throw new BadRequestException('File too large');
    }

    if (
      dirname(resolve(file.path)) !==
      this.temporaryDirectory
    ) {
      throw new BadRequestException('Invalid upload path');
    }

    const mimeType = await this.detectMime(file);

    let width: number | undefined;
    let height: number | undefined;

    if (mimeType.startsWith('image/')) {
      try {
        const metadata = await sharp(file.path, {
          limitInputPixels:
            ATTACHMENT_LIMITS.maxImagePixels,
          failOn: 'error',
        }).metadata();

        width = metadata.width;
        height = metadata.height;

        if (
          !width ||
          !height ||
          width * height >
            ATTACHMENT_LIMITS.maxImagePixels
        ) {
          throw new Error('Invalid image dimensions');
        }
      } catch {
        throw new BadRequestException(
          'Invalid or oversized image',
        );
      }
    }

    const storageKey = randomUUID();

    await rename(
      file.path,
      this.getPath(storageKey),
    );

    return {
      originalName: this.cleanFilename(file.originalname),
      storageKey,
      mimeType,
      size: BigInt(file.size),
      width,
      height,
    };
  }

  async remove(storageKey: string) {
    try {
      await unlink(this.getPath(storageKey));
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== 'ENOENT'
      ) {
        this.logger.warn('Attachment cleanup failed');
      }
    }
  }

  async removeTemporary(path: string) {
    if (
      dirname(resolve(path)) !==
      this.temporaryDirectory
    ) {
      return;
    }

    try {
      await unlink(path);
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== 'ENOENT'
      ) {
        this.logger.warn('Temporary upload cleanup failed');
      }
    }
  }
}
