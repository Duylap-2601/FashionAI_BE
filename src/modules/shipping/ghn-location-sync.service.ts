import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GhnLocationLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { GhnClient } from './providers/ghn/ghn.client';

type LocationInput = { code: string; parentCode: string | null; name: string };

@Injectable()
export class GhnLocationSyncService {
  private readonly logger = new Logger(GhnLocationSyncService.name);
  private isSyncing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ghnClient: GhnClient,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'ghn-location-sync', timeZone: 'Asia/Ho_Chi_Minh' })
  async syncFromCron() {
    await this.sync('cron');
  }

  async sync(trigger: 'cron' | 'admin' | 'startup' = 'admin') {
    if (this.isSyncing) {
      this.logger.warn(`GHN location sync skipped | trigger=${trigger} reason=already_running`);
      return { skipped: true, reason: 'already_running' };
    }

    this.isSyncing = true;
    const startedAt = Date.now();
    const counts = { provinces: 0, districts: 0, wards: 0, errors: 0 };

    try {
      const provinces = await this.fetchProvincesWithRetry();
      await this.upsertLocations(GhnLocationLevel.PROVINCE, provinces);
      counts.provinces = provinces.length;

      await this.eachLimit(provinces, 4, async (province) => {
        try {
          const districts = await this.fetchDistrictsWithRetry(province.code);
          await this.upsertLocations(GhnLocationLevel.DISTRICT, districts);
          counts.districts += districts.length;

          await this.eachLimit(districts, 4, async (district) => {
            try {
              const wards = await this.fetchWardsWithRetry(district.code);
              await this.upsertLocations(GhnLocationLevel.WARD, wards);
              counts.wards += wards.length;
            } catch (error) {
              counts.errors += 1;
              this.logger.warn(`GHN ward sync failed | districtCode=${district.code} error=${this.safeError(error)}`);
            }
          });
        } catch (error) {
          counts.errors += 1;
          this.logger.warn(`GHN district sync failed | provinceCode=${province.code} error=${this.safeError(error)}`);
        }
      });

      this.logger.log(`GHN location sync completed | trigger=${trigger} provinces=${counts.provinces} districts=${counts.districts} wards=${counts.wards} errors=${counts.errors} duration=${Date.now() - startedAt}`);
      return { skipped: false, counts };
    } finally {
      this.isSyncing = false;
    }
  }

  private async upsertLocations(level: GhnLocationLevel, locations: LocationInput[]) {
    if (locations.length === 0) return;
    await this.prisma.$transaction(
      locations.map((location) => this.prisma.ghnLocation.upsert({
        where: { level_code: { level, code: location.code } },
        create: {
          level,
          code: location.code,
          parentCode: location.parentCode,
          name: location.name,
          isActive: true,
        },
        update: {
          parentCode: location.parentCode,
          name: location.name,
          isActive: true,
        },
      })),
    );
  }

  private async fetchProvincesWithRetry() {
    const response = await this.withRetry(() => this.ghnClient.post<{ data?: unknown[] }>('/shiip/public-api/master-data/province', {}));
    return this.normalizeLocations(response.data, null, 'ProvinceID', 'ProvinceName');
  }

  private async fetchDistrictsWithRetry(provinceCode: string) {
    const response = await this.withRetry(() => this.ghnClient.post<{ data?: unknown[] }>('/shiip/public-api/master-data/district', { province_id: Number(provinceCode) }));
    return this.normalizeLocations(response.data, provinceCode, 'DistrictID', 'DistrictName');
  }

  private async fetchWardsWithRetry(districtCode: string) {
    const response = await this.withRetry(() => this.ghnClient.post<{ data?: unknown[] }>('/shiip/public-api/master-data/ward', { district_id: Number(districtCode) }));
    return this.normalizeLocations(response.data, districtCode, 'WardCode', 'WardName');
  }

  private normalizeLocations(data: unknown[] | undefined, parentCode: string | null, codeKey: string, nameKey: string) {
    const items = Array.isArray(data) ? data : [];
    const seen = new Set<string>();
    const normalized: LocationInput[] = [];

    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const rawCode = record[codeKey];
      const rawName = record[nameKey];
      const code = typeof rawCode === 'string' ? rawCode.trim() : typeof rawCode === 'number' ? String(rawCode) : '';
      const name = typeof rawName === 'string' ? rawName.trim() : '';
      if (!code || !name || seen.has(code)) continue;
      seen.add(code);
      normalized.push({ code, parentCode, name });
    }

    return normalized;
  }

  private async withRetry<T>(operation: () => Promise<T>, maxAttempts = 3): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        const status = this.extractStatus(error);
        if (status === 401 || status === 403 || attempt === maxAttempts) break;
        if (status && status >= 400 && status !== 429 && status < 500) break;
        await this.sleep(300 * attempt + Math.floor(Math.random() * 200));
      }
    }
    throw lastError;
  }

  private async eachLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        await worker(items[index]);
      }
    });
    await Promise.all(workers);
  }

  private extractStatus(error: unknown) {
    if (error && typeof error === 'object' && 'response' in error) {
      const response = (error as { response?: { status?: unknown } }).response;
      return typeof response?.status === 'number' ? response.status : undefined;
    }
    if (error && typeof error === 'object' && 'status' in error) {
      const status = (error as { status?: unknown }).status;
      return typeof status === 'number' ? status : undefined;
    }
    return undefined;
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private safeError(error: unknown) {
    if (error instanceof Error) return error.message;
    try {
      return JSON.stringify(error as Prisma.JsonValue);
    } catch {
      return 'Unknown error';
    }
  }
}
