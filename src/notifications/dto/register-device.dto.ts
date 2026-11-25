import {
  IsString,
  IsIn,
  IsOptional,
  MaxLength,
  Matches,
} from 'class-validator';

export class RegisterDeviceDto {
  @IsString()
  @Matches(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/)
  @MaxLength(255)
  pushToken!: string;

  @IsIn(['ANDROID', 'IOS'])
  platform!: 'ANDROID' | 'IOS';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  appVersion?: string;
}
