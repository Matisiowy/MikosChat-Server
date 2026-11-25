import {
  Injectable,
  BadRequestException,
  NotFoundException,
  OnModuleInit,
  PayloadTooLargeException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { MessagesService } from '../messages/messages.service';
import { AttachmentStorageService } from './attachment-storage.service';
import { ATTACHMENT_LIMITS } from './attachments.config';

import type {
  PreparedAttachment,
} from './attachments.config';

import type {
  SendAttachmentsDto,
} from './dto/send-attachments.dto';

@Injectable()
export class AttachmentsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessagesService,
    private readonly storage: AttachmentStorageService,
  ) {}

  async onModuleInit() {
    await this.storage.initialize();
  }

  async send(
    userId: string,
    conversationId: string,
    dto: SendAttachmentsDto,
    files: Express.Multer.File[],
  ) {
    const prepared: PreparedAttachment[] = [];

    let committed = false;

    try {
      if (
        !files?.length ||
        files.length > ATTACHMENT_LIMITS.maxFiles
      ) {
        throw new BadRequestException(
          'Between 1 and 5 files are required',
        );
      }

      const totalSize = files.reduce(
        (sum, file) => sum + file.size,
        0,
      );

      if (totalSize > ATTACHMENT_LIMITS.maxTotalSize) {
        throw new PayloadTooLargeException(
          'Total attachment size exceeds 100 MB',
        );
      }

      await this.storage.ensureFreeSpace(0);

      for (const file of files) {
        const attachment = await this.storage.prepare(file);
        prepared.push(attachment);
      }

      const result = await this.messages.sendAttachments(
        userId,
        conversationId,
        dto,
        prepared,
      );

      committed = result.created;

      return result.message;

    } finally {
      if (!committed) {
        await Promise.allSettled(
          prepared.map(file =>
            this.storage.remove(file.storageKey),
          ),
        );
      }

      await Promise.allSettled(
        (files ?? []).map(file =>
          this.storage.removeTemporary(file.path),
        ),
      );
    }
  }

  async getDownload(
    userId: string,
    attachmentId: string,
  ) {
    const attachment =
      await this.prisma.attachment.findFirst({
        where: {
          id: attachmentId,
          message: {
            deletedAt: null,
            conversation: {
              members: {
                some: {
                  userId,
                  leftAt: null,
                },
              },
            },
          },
        },
      });

    if (!attachment) {
      throw new NotFoundException(
        'Attachment not found',
      );
    }

    return {
      path: this.storage.getPath(
        attachment.storageKey,
      ),
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      size: Number(attachment.size),
    };
  }
}
