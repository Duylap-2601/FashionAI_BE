import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GarmentCategory, UserTier } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { UpdateGhnPickupSettingsDto } from './dto/ghn-pickup-settings.dto';
import { UpdateLiveTryOnSettingsDto } from './dto/live-try-on-settings.dto';

const GHN_PICKUP_SETTING_KEY = 'shipping.ghn.pickup_address';
const LIVE_TRY_ON_SETTING_KEY = 'try_on.live.policy';

export interface GhnPickupSettings {
  provinceId?: number;
  districtId?: number;
  wardCode?: string;
  source: 'database' | 'env' | 'empty';
}

interface SettingRow {
  value: unknown;
}

export interface LiveTryOnTierPolicySettings {
  liveEnabled: boolean;
  dailySeconds: number;
  maxSessionSeconds: number;
}

export interface LiveTryOnPolicySettings {
  enabled: boolean;
  version: number;
  globalDailyCredits: number;
  maxConcurrentSessions: number;
  pauseTimeoutSeconds: number;
  allowedCategories: GarmentCategory[];
  betaUserIds: string[];
  betaProductIds: string[];
  tiers: Record<UserTier, LiveTryOnTierPolicySettings>;
  source: 'database' | 'env';
}

@Injectable()
export class AdminSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getGhnPickupSettings(): Promise<GhnPickupSettings> {
    const rows = await this.prisma.$queryRaw<SettingRow[]>`
      SELECT value FROM app_settings WHERE key = ${GHN_PICKUP_SETTING_KEY} LIMIT 1
    `;
    const saved = this.parseGhnPickupSettings(rows[0]?.value);
    if (saved) return { ...saved, source: 'database' };

    const env = this.getEnvPickupSettings();
    if (env) return { ...env, source: 'env' };

    return { source: 'empty' };
  }

  async updateGhnPickupSettings(dto: UpdateGhnPickupSettingsDto): Promise<GhnPickupSettings> {
    const value = {
      provinceId: dto.provinceId,
      districtId: dto.districtId,
      wardCode: dto.wardCode.trim(),
    };

    await this.prisma.$executeRaw`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${GHN_PICKUP_SETTING_KEY}, ${JSON.stringify(value)}::jsonb, CURRENT_TIMESTAMP)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
    `;

    return { ...value, source: 'database' };
  }

  async getLiveTryOnSettings(): Promise<LiveTryOnPolicySettings> {
    const rows = await this.prisma.$queryRaw<SettingRow[]>`
      SELECT value FROM app_settings WHERE key = ${LIVE_TRY_ON_SETTING_KEY} LIMIT 1
    `;
    const saved = this.parseLiveTryOnSettings(rows[0]?.value);
    if (saved) return { ...saved, source: 'database' };
    return this.getEnvLiveTryOnSettings();
  }

  async updateLiveTryOnSettings(actorId: string, dto: UpdateLiveTryOnSettingsDto): Promise<LiveTryOnPolicySettings> {
    const before = await this.getLiveTryOnSettings();
    const next = this.normalizeLiveTryOnSettings({
      ...dto,
      version: (dto.version ?? before.version) + 1,
      betaUserIds: dto.betaUserIds ?? [],
      betaProductIds: dto.betaProductIds ?? [],
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (${LIVE_TRY_ON_SETTING_KEY}, ${JSON.stringify(next)}::jsonb, CURRENT_TIMESTAMP)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
      `;
      await tx.$executeRaw`
        INSERT INTO live_try_on_policy_audits (actor_id, before, after, reason)
        VALUES (${actorId}::uuid, ${JSON.stringify(before)}::jsonb, ${JSON.stringify(next)}::jsonb, ${dto.reason ?? null})
      `;
    });

    return { ...next, source: 'database' };
  }

  private getEnvPickupSettings() {
    const provinceId = Number(this.configService.get<string>('GHN_FROM_PROVINCE_ID'));
    const districtId = Number(this.configService.get<string>('GHN_FROM_DISTRICT_ID'));
    const wardCode = this.configService.get<string>('GHN_FROM_WARD_CODE') ?? this.configService.get<string>('GHN_FROM_WARD_ID');

    if (!Number.isFinite(districtId) || districtId <= 0 || !wardCode?.trim()) return null;

    return {
      provinceId: Number.isFinite(provinceId) && provinceId > 0 ? provinceId : undefined,
      districtId,
      wardCode: wardCode.trim(),
    };
  }

  private parseGhnPickupSettings(value: unknown) {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    const provinceId = Number(record.provinceId);
    const districtId = Number(record.districtId);
    const wardCode = typeof record.wardCode === 'string' ? record.wardCode.trim() : '';

    if (!Number.isFinite(districtId) || districtId <= 0 || !wardCode) return null;

    return {
      provinceId: Number.isFinite(provinceId) && provinceId > 0 ? provinceId : undefined,
      districtId,
      wardCode,
    };
  }

  private getEnvLiveTryOnSettings(): LiveTryOnPolicySettings {
    const memberDaily = Number(this.configService.get<string>('DECART_LIVE_MEMBER_DAILY_SECONDS') ?? this.configService.get<string>('DECART_LIVE_USER_DAILY_SECONDS') ?? '120');
    const vipDaily = Number(this.configService.get<string>('DECART_LIVE_VIP_DAILY_SECONDS') ?? this.configService.get<string>('DECART_LIVE_USER_DAILY_SECONDS') ?? '300');
    const memberSession = Number(this.configService.get<string>('DECART_LIVE_MEMBER_MAX_SESSION_SECONDS') ?? '30');
    const vipSession = Number(this.configService.get<string>('DECART_LIVE_VIP_MAX_SESSION_SECONDS') ?? this.configService.get<string>('DECART_LIVE_MAX_DURATION_SECONDS') ?? '60');

    return {
      enabled: this.configService.get<string>('DECART_LIVE_TRYON_ENABLED') === 'true',
      version: 1,
      globalDailyCredits: Number(this.configService.get<string>('DECART_LIVE_GLOBAL_DAILY_CREDITS') ?? '12000'),
      maxConcurrentSessions: Number(this.configService.get<string>('DECART_LIVE_MAX_CONCURRENT_SESSIONS') ?? '5'),
      pauseTimeoutSeconds: Number(this.configService.get<string>('DECART_LIVE_PAUSE_TIMEOUT_SECONDS') ?? '300'),
      allowedCategories: parseCategories(this.configService.get<string>('DECART_LIVE_ALLOWED_CATEGORIES') ?? 'UPPER,LOWER,FULL_BODY'),
      betaUserIds: parseCsv(this.configService.get<string>('DECART_LIVE_BETA_USER_IDS')),
      betaProductIds: parseCsv(this.configService.get<string>('DECART_LIVE_BETA_PRODUCT_IDS')),
      tiers: {
        FREE: { liveEnabled: this.configService.get<string>('DECART_LIVE_FREE_ENABLED') === 'true', dailySeconds: Number(this.configService.get<string>('DECART_LIVE_FREE_DAILY_SECONDS') ?? '0'), maxSessionSeconds: Number(this.configService.get<string>('DECART_LIVE_FREE_MAX_SESSION_SECONDS') ?? '0') },
        MEMBER: { liveEnabled: true, dailySeconds: memberDaily, maxSessionSeconds: memberSession },
        VIP: { liveEnabled: true, dailySeconds: vipDaily, maxSessionSeconds: vipSession },
      },
      source: 'env',
    };
  }

  private parseLiveTryOnSettings(value: unknown) {
    if (!value || typeof value !== 'object') return null;
    return this.normalizeLiveTryOnSettings(value as Record<string, unknown>);
  }

  private normalizeLiveTryOnSettings(value: Record<string, unknown>): Omit<LiveTryOnPolicySettings, 'source'> {
    const fallback = this.getEnvLiveTryOnSettings();
    const tiers = value.tiers && typeof value.tiers === 'object' ? value.tiers as Record<string, unknown> : {};
    return {
      enabled: typeof value.enabled === 'boolean' ? value.enabled : fallback.enabled,
      version: Number.isInteger(value.version) ? Number(value.version) : fallback.version,
      globalDailyCredits: positiveInt(value.globalDailyCredits, fallback.globalDailyCredits),
      maxConcurrentSessions: positiveInt(value.maxConcurrentSessions, fallback.maxConcurrentSessions),
      pauseTimeoutSeconds: positiveInt(value.pauseTimeoutSeconds, fallback.pauseTimeoutSeconds),
      allowedCategories: Array.isArray(value.allowedCategories) ? parseCategories(value.allowedCategories.join(',')) : fallback.allowedCategories,
      betaUserIds: Array.isArray(value.betaUserIds) ? value.betaUserIds.filter((item): item is string => typeof item === 'string') : [],
      betaProductIds: Array.isArray(value.betaProductIds) ? value.betaProductIds.filter((item): item is string => typeof item === 'string') : [],
      tiers: {
        FREE: normalizeTier(tiers.FREE, fallback.tiers.FREE),
        MEMBER: normalizeTier(tiers.MEMBER, fallback.tiers.MEMBER),
        VIP: normalizeTier(tiers.VIP, fallback.tiers.VIP),
      },
    };
  }
}

function parseCsv(value?: string) {
  return (value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

function parseCategories(value: string) {
  const categories = value.split(',').map((item) => item.trim()).filter((item): item is GarmentCategory => item in GarmentCategory);
  return categories.length > 0 ? categories : [GarmentCategory.UPPER];
}

function positiveInt(value: unknown, fallback: number) {
  const next = Number(value);
  return Number.isInteger(next) && next >= 0 ? next : fallback;
}

function normalizeTier(value: unknown, fallback: LiveTryOnTierPolicySettings): LiveTryOnTierPolicySettings {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    liveEnabled: typeof record.liveEnabled === 'boolean' ? record.liveEnabled : fallback.liveEnabled,
    dailySeconds: positiveInt(record.dailySeconds, fallback.dailySeconds),
    maxSessionSeconds: positiveInt(record.maxSessionSeconds, fallback.maxSessionSeconds),
  };
}
