import { Controller, Get } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

@Controller('version')
export class VersionController {
  private readonly version: string = JSON.parse(
    readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
  ).version;

  @Get()
  getVersion() {
    return {
      name: 'MikosChat',
      version: this.version,
      apiVersion: 1,
    };
  }
}
