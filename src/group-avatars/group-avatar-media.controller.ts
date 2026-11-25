import {
  Controller,
  Get,
  Param,
  Req,
  UseGuards,
  Header,
  StreamableFile,
} from '@nestjs/common';

import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthRequest } from '../common/auth-request';
import { GroupAvatarsService } from './group-avatars.service';

@ApiTags('Group Avatars')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('media/group-avatars')
export class GroupAvatarMediaController {
  constructor(
    private readonly avatars: GroupAvatarsService,
  ) {}

  @Get(':filename')
  @Header('Cache-Control', 'private, no-store')
  @Header('Cross-Origin-Resource-Policy', 'same-site')
  async avatar(
    @Req() req: AuthRequest,
    @Param('filename') filename: string,
  ) {
    const file = await this.avatars.download(
      req.user.userId,
      filename,
    );

    return new StreamableFile(
      file.createReadStream(),
      { type: 'image/webp' },
    );
  }
}
