import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class TransferOwnerDto {
  @ApiProperty()
  @IsUUID('4')
  userId!: string;
}
