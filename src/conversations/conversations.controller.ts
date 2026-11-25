import { MuteConversationDto } from './dto/mute-conversation.dto';
import {
  Controller,
  Patch,
  Delete,
  Get,
  Post,
  Body,
  Param,
  Req,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthRequest } from '../common/auth-request';
import { ConversationsService } from './conversations.service';
import { CreateDirectDto } from './dto/create-direct.dto';
import { CreateGroupDto } from './dto/create-group.dto';

@ApiTags('Conversations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get conversations' })
  list(@Req() req: AuthRequest) {
    return this.conversations.list(req.user.userId);
  }

  @Post('direct')
  @ApiOperation({ summary: 'Create direct conversation' })
  direct(
    @Req() req: AuthRequest,
    @Body() dto: CreateDirectDto,
  ) {
    return this.conversations.createDirect(
      req.user.userId,
      dto.userId,
    );
  }

  @Post('group')
  @ApiOperation({ summary: 'Create group conversation' })
  group(
    @Req() req: AuthRequest,
    @Body() dto: CreateGroupDto,
  ) {
    return this.conversations.createGroup(
      req.user.userId,
      dto.name,
      dto.memberIds,
    );
  }

  @Get(':id/settings')
  @ApiOperation({ summary: 'Get own conversation settings' })
  async settings(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const member = await this.conversations.requireMembership(
      req.user.userId,
      id.toLowerCase(),
    );

    return {
      conversationId: id.toLowerCase(),
      mutedUntil: member.mutedUntil,
      archived: member.archived,
      lastReadAt: member.lastReadAt,
    };
  }

  @Patch(':id/mute')
  @ApiOperation({ summary: 'Mute conversation notifications' })
  mute(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MuteConversationDto,
  ) {
    return this.conversations.mute(
      req.user.userId,
      id,
      dto.duration,
    );
  }

  @Delete(':id/mute')
  @ApiOperation({ summary: 'Unmute conversation notifications' })
  unmute(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.conversations.unmute(
      req.user.userId,
      id,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get conversation details' })
  get(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.conversations.get(req.user.userId, id);
  }
}
