import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  ParseUUIDPipe,
  StreamableFile,
  NotFoundException,
  Header,
} from '@nestjs/common';

import {
  FilesInterceptor,
} from '@nestjs/platform-express';

import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';

import { Throttle } from '@nestjs/throttler';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { join } from 'node:path';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthRequest } from '../common/auth-request';

import { AttachmentsService } from './attachments.service';
import { SendAttachmentsDto } from './dto/send-attachments.dto';
import { AttachmentUploadGuard } from './guards/attachment-upload.guard';
import { UploadCleanupInterceptor } from './interceptors/upload-cleanup.interceptor';
import { ATTACHMENT_LIMITS } from './attachments.config';

@ApiTags('Attachments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class AttachmentsController {
  constructor(
    private readonly attachments: AttachmentsService,
  ) {}

  @Post('conversations/:id/attachments')
  @UseGuards(AttachmentUploadGuard)
  @Throttle({
    default: {
      limit: 10,
      ttl: 60000,
    },
  })
  @ApiOperation({
    summary: 'Send message with attachments',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: [
        'clientMessageId',
        'files',
      ],
      properties: {
        clientMessageId: {
          type: 'string',
          format: 'uuid',
        },
        content: {
          type: 'string',
          maxLength: 4000,
        },
        replyToId: {
          type: 'string',
          format: 'uuid',
        },
        files: {
          type: 'array',
          maxItems: 5,
          items: {
            type: 'string',
            format: 'binary',
          },
        },
      },
    },
  })
  @UseInterceptors(
    UploadCleanupInterceptor,
    FilesInterceptor(
      'files',
      ATTACHMENT_LIMITS.maxFiles,
      {
        storage: diskStorage({
          destination: (_req, _file, callback) => {
            callback(
              null,
              join(
                process.env.STORAGE_PATH ??
                  './storage',
                'uploads',
              ),
            );
          },
          filename: (_req, _file, callback) => {
            callback(null, randomUUID());
          },
        }),
        limits: {
          fileSize: ATTACHMENT_LIMITS.maxFileSize,
          files: ATTACHMENT_LIMITS.maxFiles,
          fields: 3,
          fieldSize: 16384,
          parts: 9,
        },
      },
    ),
  )
  send(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendAttachmentsDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.attachments.send(
      req.user.userId,
      id,
      dto,
      files,
    );
  }

  @Get('attachments/:id/download')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({
    summary: 'Download private attachment',
  })
  async download(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const attachment =
      await this.attachments.getDownload(
        req.user.userId,
        id,
      );

    let file;

    try {
      file = await open(attachment.path, 'r');
    } catch {
      throw new NotFoundException(
        'Attachment file not found',
      );
    }

    const filename = encodeURIComponent(
      attachment.originalName,
    ).replace(
      /['()*]/g,
      char =>
        '%' +
        char.charCodeAt(0).toString(16).toUpperCase(),
    );

    return new StreamableFile(
      file.createReadStream(),
      {
        type: attachment.mimeType,
        length: attachment.size,
        disposition:
          `attachment; filename="attachment"; filename*=UTF-8''${filename}`,
      },
    );
  }
}
