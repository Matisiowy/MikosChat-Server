import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class FriendRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  userId!: string;
}
