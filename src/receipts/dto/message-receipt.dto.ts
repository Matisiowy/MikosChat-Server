import { IsUUID } from 'class-validator';

export class MessageReceiptDto {
  @IsUUID()
  messageId!: string;
}
