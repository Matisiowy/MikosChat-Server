import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class PresenceService {
  private readonly ttl = 90;

  constructor(private readonly redis: RedisService) {}

  private key(userId: string) {
    return `mikoschat:presence:${userId}`;
  }

  async heartbeat(userId: string, socketId: string) {
    const key = this.key(userId);
    const now = Date.now();

    await this.redis.client
      .multi()
      .zremrangebyscore(key, '-inf', now)
      .zadd(key, now + this.ttl * 1000, socketId)
      .expire(key, this.ttl + 10)
      .exec();
  }

  async connect(userId: string, socketId: string) {
    await this.heartbeat(userId, socketId);
  }

  async disconnect(userId: string, socketId: string) {
    const key = this.key(userId);

    await this.redis.client.zrem(key, socketId);

    return this.isOnline(userId);
  }

  async isOnline(userId: string): Promise<boolean> {
    const count = await this.redis.client.zcount(
      this.key(userId),
      `(${Date.now()}`,
      '+inf',
    );

    return count > 0;
  }

  async getStatuses(userIds: string[]) {
    return Promise.all(
      userIds.map(async userId => ({
        userId,
        online: await this.isOnline(userId),
      })),
    );
  }
}
