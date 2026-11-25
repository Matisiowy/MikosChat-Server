import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MuteConversationDto {
  @ApiProperty({
    enum: [15, 60, 480, 1440, -1],
    description: 'Duration in minutes; -1 means indefinitely',
  })
  @IsIn([15, 60, 480, 1440, -1])
  duration!: number;
}
