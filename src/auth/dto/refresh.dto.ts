import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @Matches(/^[a-f0-9]{128}$/)
  refreshToken!: string;
}
