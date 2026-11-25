import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  MinLength,
  MaxLength,
} from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'mikos' })
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  identifier!: string;

  @ApiProperty({ format: 'password' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({ example: 'Windows Desktop' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceName?: string;
}
