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

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Kiểm tra trạng thái ứng dụng, database và Redis' })
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
    ]);
  }
}
