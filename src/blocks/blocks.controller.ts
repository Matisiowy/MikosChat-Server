import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Req,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthRequest } from '../common/auth-request';
import { BlocksService } from './blocks.service';

@ApiTags('Blocks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('blocks')
export class BlocksController {
  constructor(private readonly blocks: BlocksService) {}

  @Get()
  @ApiOperation({ summary: 'Get blocked users' })
  list(@Req() req: AuthRequest) {
    return this.blocks.list(req.user.userId);
  }

  @Post(':userId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Block user' })
  block(
    @Req() req: AuthRequest,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.blocks.block(req.user.userId, userId);
  }

  @Delete(':userId')
  @ApiOperation({ summary: 'Unblock user' })
  unblock(
    @Req() req: AuthRequest,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.blocks.unblock(req.user.userId, userId);
  }
}
