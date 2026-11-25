import {
  Controller,
  Post,
  Delete,
  Param,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  ParseUUIDPipe,
} from '@nestjs/common';

import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Throttle } from '@nestjs/throttler';

import {
  ApiTags,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthRequest } from '../common/auth-request';
import { GroupAvatarsService } from './group-avatars.service';

@ApiTags('Group Avatars')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('groups/:id/avatar')
export class GroupAvatarsController {
  constructor(
    private readonly avatars: GroupAvatarsService,
  ) {}

  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
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
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.avatars.upload(
      req.user.userId,
      id,
      file,
    );
  }

  @Delete()
  @HttpCode(200)
  remove(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.avatars.remove(
      req.user.userId,
      id,
    );
  }
}
