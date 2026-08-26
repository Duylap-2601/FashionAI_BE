import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { PrismaService } from '../../database/prisma.service';
import { Public } from '../../common/decorators/public.decorator';
import { RedisService } from '../../common/services/redis.service';
import { RealtimeEmitter } from '../realtime/realtime.emitter';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly realtimeEmitter: RealtimeEmitter,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Kiểm tra trạng thái ứng dụng, database, Redis và WebSocket' })
  check() {
    return this.health.check([
      () => this.prismaHealth.pingCheck('database', this.prisma),
      async () => {
        const redis = await this.redisService.health();
        return {
          redis: {
            status: redis.status,
            mode: redis.mode,
          },
        };
      },
      async () => {
        const ws = this.realtimeEmitter.status();
        // Luôn 'up' để không làm health endpoint trả 503 (Render dùng cái này để
        // quyết định deploy sống/chết). Trạng thái sẵn sàng thật nằm ở cờ 'ready'.
        return {
          websocket: {
            status: 'up',
            ready: ws.ready,
            clients: ws.clients,
          },
        };
      },
    ]);
  }
}
