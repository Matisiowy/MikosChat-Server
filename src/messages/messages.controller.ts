import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Query,
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
import { MessagesService } from './messages.service';
import { SendMessageDto } from './dto/send-message.dto';
import { EditMessageDto } from './dto/edit-message.dto';
import { MessageHistoryDto } from './dto/message-history.dto';

@ApiTags('Messages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class MessagesController {
  constructor(
    private readonly messages: MessagesService,
  ) {}

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'Get message history' })
  history(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() dto: MessageHistoryDto,
  ) {
    return this.messages.history(
      req.user.userId,
      id,
      dto,
    );
  }

  @Post('conversations/:id/messages')
  @ApiOperation({ summary: 'Send message' })
  send(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.messages.send(
      req.user.userId,
      id,
      dto,
    );
  }

  @Patch('messages/:id')
  @ApiOperation({ summary: 'Edit message' })
  edit(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditMessageDto,
  ) {
    return this.messages.edit(
      req.user.userId,
      id,
      dto.content,
    );
  }

  @Delete('messages/:id')
  @ApiOperation({ summary: 'Delete message' })
  remove(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.messages.remove(
      req.user.userId,
      id,
    );
  }
}
