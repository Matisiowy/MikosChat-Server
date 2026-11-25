import { IsUUID } from 'class-validator';
import { SendMessageDto } from '../../messages/dto/send-message.dto';

export class SocketMessageDto extends SendMessageDto {
  @IsUUID()
  conversationId!: string;
}
