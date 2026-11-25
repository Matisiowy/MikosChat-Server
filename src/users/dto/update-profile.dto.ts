import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Mikos' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(/\S/)
  displayName?: string;

  @ApiPropertyOptional({ example: 'Welcome to my profile!' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;
}
