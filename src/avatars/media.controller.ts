import {
  Controller,
  Get,
  Param,
  StreamableFile,
  NotFoundException,
  Header,
} from '@nestjs/common';

import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { open } from 'node:fs/promises';
import { AvatarsService } from './avatars.service';

@ApiTags('Media')
@Controller('media')
export class MediaController {
  constructor(
    private readonly avatars: AvatarsService,
  ) {}

  @Get('avatars/:filename')
  @SkipThrottle()
  @Header('Cross-Origin-Resource-Policy', 'same-site')
  @Header('Cache-Control', 'public, max-age=3600')
  @ApiOperation({ summary: 'Get profile picture' })
  async avatar(
    @Param('filename') filename: string,
  ) {
    const path = this.avatars.getPath(filename);

    try {
      const file = await open(path, 'r');

      return new StreamableFile(
        file.createReadStream(),
        { type: 'image/webp' },
      );
    } catch {
      throw new NotFoundException('Avatar not found');
    }
  }
}
