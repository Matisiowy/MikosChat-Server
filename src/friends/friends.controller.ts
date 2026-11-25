import {
  Body,
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
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthRequest } from '../common/auth-request';
import { FriendsService } from './friends.service';
import { FriendRequestDto } from './dto/friend-request.dto';

@ApiTags('Friends')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('friends')
export class FriendsController {
  constructor(private readonly friends: FriendsService) {}

  @Get()
  @ApiOperation({ summary: 'Get friends list' })
  list(@Req() req: AuthRequest) {
    return this.friends.list(req.user.userId);
  }

  @Get('requests')
  @ApiOperation({ summary: 'Get incoming and outgoing requests' })
  requests(@Req() req: AuthRequest) {
    return this.friends.requests(req.user.userId);
  }

  @Post('request')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Send friend request' })
  request(
    @Req() req: AuthRequest,
    @Body() dto: FriendRequestDto,
  ) {
    return this.friends.request(req.user.userId, dto.userId);
  }

  @Post(':id/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accept friend request' })
  accept(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.friends.accept(req.user.userId, id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject friend request' })
  reject(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.friends.reject(req.user.userId, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove friend or cancel request' })
  remove(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.friends.remove(req.user.userId, id);
  }
}
