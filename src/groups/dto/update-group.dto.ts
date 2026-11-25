import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  MinLength,
  MaxLength,
  Matches,
  ValidateIf,
} from 'class-validator';

export class UpdateGroupDto {
  @ApiPropertyOptional({ example: 'Ekipa MikosChat' })
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/\S/)
  name?: string;

  @ApiPropertyOptional({ example: 'Nasza prywatna grupa' })
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(500)
  description?: string;
}
