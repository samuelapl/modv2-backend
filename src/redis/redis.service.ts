import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6381);

    this.client = new Redis({
      host,
      port,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    });

    this.client
      .connect()
      .then(() => {
        this.logger.log(`Connected to Redis at ${host}:${port}`);
      })
      .catch((err) => {
        this.logger.warn(`Redis connection warning at ${host}:${port}: ${err.message}`);
      });
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
      this.logger.log('Redis connection closed.');
    }
  }

  getClient(): Redis {
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    try {
      if (ttlSeconds) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
    } catch {
      this.logger.warn(`Redis set failed for key ${key}`);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch {
      this.logger.warn(`Redis del failed for key ${key}`);
    }
  }

  async incrementWithTtl(key: string, ttlSeconds: number): Promise<number> {
    try {
      const count = await this.client.incr(key);
      if (count === 1) {
        await this.client.expire(key, ttlSeconds);
      }
      return count;
    } catch {
      this.logger.warn(`Redis increment failed for key ${key}`);
      return 0;
    }
  }
}
