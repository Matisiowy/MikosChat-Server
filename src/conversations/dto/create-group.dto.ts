import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  MinLength,
  MaxLength,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  ArrayUnique,
  IsUUID,
  Matches,
} from 'class-validator';

export class CreateGroupDto {
  @ApiProperty({ example: 'Ekipa MikosChat' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/\S/)
  name!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(49)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  memberIds!: string[];
}
