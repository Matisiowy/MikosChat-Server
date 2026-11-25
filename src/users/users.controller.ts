import {
  Body,
  Controller,
  Get,
  Patch,
  Param,
  Query,
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
import { UsersService } from './users.service';
import { SearchUsersDto } from './dto/search-users.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('search')
  @ApiOperation({ summary: 'Search users' })
  search(
    @Req() req: AuthRequest,
    @Query() dto: SearchUsersDto,
  ) {
    return this.users.search(req.user.userId, dto);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update current profile' })
  update(
    @Req() req: AuthRequest,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.users.updateProfile(req.user.userId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get public user profile' })
  getProfile(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.users.getProfile(req.user.userId, id);
  }
}
