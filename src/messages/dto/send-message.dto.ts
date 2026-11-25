import {
  IsString,
  IsUUID,
  IsOptional,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';

export class SendMessageDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  clientMessageId!: string;

  @ApiProperty({ example: 'Siema! MikosChat działa!' })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  @Matches(/\S/)
  content!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  replyToId?: string;
}
