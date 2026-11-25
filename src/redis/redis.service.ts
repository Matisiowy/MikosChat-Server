import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService
  implements OnModuleInit, OnModuleDestroy {

  private readonly logger = new Logger('Redis');
  readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis(
      config.getOrThrow<string>('REDIS_URL'),
      {
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        connectTimeout: 5000,
      },
    );

    this.client.on('error', error => {
      this.logger.error(error.message);
    });
  }

  async onModuleInit() {
    await this.client.connect();
    await this.client.ping();
    this.logger.log('Redis connected');
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
