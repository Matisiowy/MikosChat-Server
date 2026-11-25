import {
  Controller,
  Patch,
  Post,
  Delete,
  Body,
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

import { GroupsService } from './groups.service';

import { UpdateGroupDto } from './dto/update-group.dto';
import { AddMembersDto } from './dto/add-members.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { TransferOwnerDto } from './dto/transfer-owner.dto';

@ApiTags('Groups')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('groups')
export class GroupsController {
  constructor(
    private readonly groups: GroupsService,
  ) {}

  @Patch(':id')
  @ApiOperation({ summary: 'Update group details' })
  update(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGroupDto,
  ) {
    return this.groups.update(
      req.user.userId,
      id,
      dto,
    );
  }

  @Post(':id/members')
  @HttpCode(200)
  @ApiOperation({ summary: 'Add group members' })
  addMembers(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMembersDto,
  ) {
    return this.groups.addMembers(
      req.user.userId,
      id,
      dto.memberIds,
    );
  }

  @Delete(':id/members/:userId')
  @ApiOperation({ summary: 'Remove group member' })
  removeMember(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.groups.removeMember(
      req.user.userId,
      id,
      userId,
    );
  }

  @Patch(':id/members/:userId/role')
  @ApiOperation({ summary: 'Update member role' })
  updateRole(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.groups.updateRole(
      req.user.userId,
      id,
      userId,
      dto.role,
    );
  }

  @Post(':id/transfer-owner')
  @HttpCode(200)
  @ApiOperation({ summary: 'Transfer group ownership' })
  transferOwner(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransferOwnerDto,
  ) {
    return this.groups.transferOwner(
      req.user.userId,
      id,
      dto.userId,
    );
  }

  @Post(':id/leave')
  @HttpCode(200)
  @ApiOperation({ summary: 'Leave group' })
  leave(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.groups.leave(
      req.user.userId,
      id,
    );
  }
}
