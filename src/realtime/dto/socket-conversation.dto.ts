import { IsUUID } from 'class-validator';

export class SocketConversationDto {
  @IsUUID()
  conversationId!: string;
}
