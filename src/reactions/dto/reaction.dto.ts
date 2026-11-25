import { IsString, IsIn } from 'class-validator';

export const ALLOWED_REACTIONS = [
  '❤️',
  '😂',
  '😮',
  '😢',
  '😡',
  '👍',
  '👎',
  '🔥',
  '💀',
  '🎉',
  '😍',
  '🤔',
] as const;

export class ReactionDto {
  @IsString()
  @IsIn(ALLOWED_REACTIONS)
  emoji!: string;
}
