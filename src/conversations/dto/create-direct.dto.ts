import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateDirectDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  userId!: string;
}
