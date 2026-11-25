import {
  Controller,
  Put,
  Delete,
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
import { ReactionsService } from './reactions.service';
import { ReactionDto } from './dto/reaction.dto';

@ApiTags('Reactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('messages')
export class ReactionsController {
  constructor(
    private readonly reactions: ReactionsService,
  ) {}

  @Put(':id/reaction')
  @ApiOperation({ summary: 'Set message reaction' })
  set(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReactionDto,
  ) {
    return this.reactions.set(
      req.user.userId,
      id,
      dto.emoji,
    );
  }

  @Delete(':id/reaction')
  @ApiOperation({ summary: 'Remove message reaction' })
  remove(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reactions.remove(
      req.user.userId,
      id,
    );
  }
}
