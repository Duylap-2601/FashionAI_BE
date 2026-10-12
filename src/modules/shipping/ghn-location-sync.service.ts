import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GhnAddressModel, GhnLocationLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { GhnClient } from './providers/ghn/ghn.client';

type LocationInput = { code: string; parentCode: string | null; name: string; aliases?: string[]; providerStatus?: number; isActive?: boolean };

@Injectable()
export class GhnLocationSyncService {
  private readonly logger = new Logger(GhnLocationSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ghnClient: GhnClient,
    private readonly redisService: RedisService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'ghn-location-sync', timeZone: 'Asia/Ho_Chi_Minh' })
  async syncFromCron() {
    await this.sync('cron');
  }


  async sync(trigger: 'cron' | 'admin' | 'startup' = 'admin') {
    const lockKey = 'ghn:location-sync';
    const locked = await this.redisService.acquireLock(lockKey, 60);
    if (!locked) {
      this.logger.warn(`GHN location sync skipped | trigger=${trigger} reason=already_running`);
      return { skipped: true, reason: 'already_running' };
    }

    const startedAt = Date.now();
    const metadata = await this.prisma.ghnCatalogMetadata.findUnique({ where: { addressModel: GhnAddressModel.POST_MERGER_2_LEVEL } });
    const generation = (metadata?.publishedGeneration ?? BigInt(0)) + BigInt(1);
    const run = await this.prisma.ghnLocationSyncRun.create({
      data: { addressModel: GhnAddressModel.POST_MERGER_2_LEVEL, catalogGeneration: generation, status: 'RUNNING' },
    });

    const counts = { provinces: 0, wards: 0 };
    try {
      const provinces = await this.fetchProvinces();
      if (provinces.length === 0) throw new Error('GHN province catalog is empty');
      await this.upsertLocations(GhnLocationLevel.PROVINCE, generation, provinces, run.id);
      counts.provinces = provinces.length;

      await this.eachLimit(provinces, 4, async (province) => {
        const wards = await this.fetchWards(province.code);
        await this.upsertLocations(GhnLocationLevel.WARD, generation, wards, run.id);
        counts.wards += wards.length;
      });

      await this.prisma.$transaction(async (tx) => {
        const nextRevision = (metadata?.catalogRevision ?? BigInt(0)) + BigInt(1);
        await tx.ghnCatalogPublication.create({
          data: {
            addressModel: GhnAddressModel.POST_MERGER_2_LEVEL,
            catalogGeneration: generation,
            catalogRevision: nextRevision,
            retainedUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });
        await tx.ghnCatalogMetadata.upsert({
          where: { addressModel: GhnAddressModel.POST_MERGER_2_LEVEL },
          create: { addressModel: GhnAddressModel.POST_MERGER_2_LEVEL, publishedGeneration: generation, catalogRevision: nextRevision },
          update: { publishedGeneration: generation, catalogRevision: nextRevision },
        });
        await tx.ghnLocationSyncRun.update({
          where: { id: run.id },
          data: { status: 'SUCCEEDED', fetchedCounts: counts as Prisma.InputJsonValue, completedAt: new Date() },
        });
      });

      this.logger.log(`GHN location sync completed | trigger=${trigger} provinces=${counts.provinces} wards=${counts.wards} generation=${generation} duration=${Date.now() - startedAt}`);
      return { skipped: false, generation: generation.toString(), counts };
    } catch (error) {
      await this.prisma.ghnLocationSyncRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', fetchedCounts: counts as Prisma.InputJsonValue, errorSummary: this.safeError(error), completedAt: new Date() },
      });
      throw error;
    } finally {
      await this.redisService.releaseLock(lockKey);
    }
  }

  private async upsertLocations(level: GhnLocationLevel, generation: bigint, locations: LocationInput[], syncRunId: string) {
    if (locations.length === 0) return;
    await this.prisma.$transaction(
      locations.map((location) => this.prisma.ghnLocation.upsert({
        where: {
          catalogGeneration_addressModel_level_code: {
            catalogGeneration: generation,
            addressModel: GhnAddressModel.POST_MERGER_2_LEVEL,
            level,
            code: location.code,
          },
        },
        create: {
          addressModel: GhnAddressModel.POST_MERGER_2_LEVEL,
          catalogGeneration: generation,
          level,
          code: location.code,
          parentCode: location.parentCode,
          name: location.name,
          aliases: location.aliases ?? [],
          providerStatus: location.providerStatus,
          lastSeenSyncId: syncRunId,
          isActive: location.isActive ?? true,
        },
        update: {
          parentCode: location.parentCode,
          name: location.name,
          aliases: location.aliases ?? [],
          providerStatus: location.providerStatus,
          lastSeenSyncId: syncRunId,
          isActive: location.isActive ?? true,
        },
      })),
    );
  }

  private async fetchProvinces() {
    const data = await this.fetchPagedV3('/shiip/public-api/v3/master-data/province/all', {}, 'province');
    return this.normalizeLocations(data, null);
  }

  private async fetchWards(provinceCode: string) {
    const data = await this.fetchPagedV3('/shiip/public-api/v3/master-data/ward/all-by-province-id', { province_id: provinceCode }, 'ward');
    return this.normalizeLocations(data, provinceCode);
  }

  private async fetchPagedV3(path: string, baseParams: Record<string, unknown>, scope: string) {
    const limit = 200;
    const maxPages = 100;
    const maxItems = 20000;
    const all: unknown[] = [];
    const seen = new Set<string>();

    for (let page = 0; page < maxPages; page += 1) {
      const offset = page * limit;
      const response = await this.withRetry(() => this.ghnClient.get<{ data?: unknown[] }>(path, { ...baseParams, limit, offset }));
      const items = Array.isArray(response.data) ? response.data : [];
      let added = 0;
      for (const item of items) {
        const id = this.extractProviderId(item);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        all.push(item);
        added += 1;
      }
      if (all.length > maxItems) throw new Error(`GHN ${scope} catalog exceeded max item guard`);
      if (items.length < limit) return all;
      if (added === 0) throw new Error(`GHN ${scope} catalog pagination made no progress`);
    }

    throw new Error(`GHN ${scope} catalog exceeded max page guard`);
  }

  private normalizeLocations(data: unknown[], parentCode: string | null) {
    const seen = new Set<string>();
    const normalized: LocationInput[] = [];
    for (const item of data) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const code = this.toNonEmptyString(record._id ?? record.id ?? record.code);
      const name = this.toNonEmptyString(record.name ?? record.ProvinceName ?? record.WardName);
      const parent = this.toNonEmptyString(record.parent_id ?? record.province_id) || parentCode;
      if (!code || !name || seen.has(code)) continue;
      seen.add(code);
      const status = typeof record.status === 'number' ? record.status : undefined;
      normalized.push({
        code,
        parentCode: parentCode === null ? null : parent,
        name,
        aliases: Array.isArray(record.extension_names) ? record.extension_names.filter((alias): alias is string => typeof alias === 'string' && alias.trim().length > 0) : [],
        providerStatus: status,
        isActive: status === undefined || status === 1,
      });
    }
    return normalized;
  }

  private extractProviderId(item: unknown) {
    if (!item || typeof item !== 'object') return '';
    return this.toNonEmptyString((item as Record<string, unknown>)._id ?? (item as Record<string, unknown>).id ?? (item as Record<string, unknown>).code);
  }

  private toNonEmptyString(value: unknown) {
    const text = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
    return text;
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
