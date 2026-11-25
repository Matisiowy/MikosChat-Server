import {
  IsUUID,
  IsString,
  IsOptional,
  MaxLength,
} from 'class-validator';

export class SendAttachmentsDto {
  @IsUUID('4')
  clientMessageId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  content?: string;

  @IsOptional()
  @IsUUID()
  replyToId?: string;
}
