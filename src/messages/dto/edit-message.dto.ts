import {
  IsString,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class EditMessageDto {
  @ApiProperty({ example: 'Poprawiona wiadomość' })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  @Matches(/\S/)
  content!: string;
}
