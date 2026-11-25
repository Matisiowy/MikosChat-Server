import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { LoginDto } from './login.dto';
import { RegisterDto } from './register.dto';

export class WebLoginDto extends LoginDto {
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}

export class WebRegisterDto extends RegisterDto {
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}
