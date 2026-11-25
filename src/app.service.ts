import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getInfo() {
    return {
      name: 'MikosChat',
      version: '0.1.0',
      apiVersion: 'v1',
      description: 'MikosChat Messaging Platform',
      status: 'online',
    };
  }

  getHealth() {
    return {
      status: 'online',
      service: 'mikoschat-api',
      version: '0.1.0',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
