import {
  Controller,
  Post,
  Req,
  Param,
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
import { ReceiptsService } from './receipts.service';

@ApiTags('Receipts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('messages')
export class ReceiptsController {
  constructor(
    private readonly receipts: ReceiptsService,
  ) {}

  @Post(':id/delivered')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm message delivery' })
  delivered(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.receipts.delivered(req.user.userId, id);
  }

  @Post(':id/read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm message read' })
  read(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.receipts.read(req.user.userId, id);
  }
}
