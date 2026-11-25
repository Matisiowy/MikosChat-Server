import {
  Controller,
  Post,
  Delete,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
} from '@nestjs/common';

import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Throttle } from '@nestjs/throttler';

import {
  ApiTags,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiOperation,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthRequest } from '../common/auth-request';
import { AvatarsService } from './avatars.service';

@ApiTags('Avatars')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users/me/avatar')
export class AvatarsController {
  constructor(
    private readonly avatars: AvatarsService,
  ) {}

  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Upload profile picture' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: {
      fileSize: 5 * 1024 * 1024,
      files: 1,
      fields: 0,
      parts: 2,
    },
  }))
  upload(
    @Req() req: AuthRequest,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.avatars.upload(req.user.userId, file);
  }

  @Delete()
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove profile picture' })
  remove(@Req() req: AuthRequest) {
    return this.avatars.remove(req.user.userId);
  }
}
