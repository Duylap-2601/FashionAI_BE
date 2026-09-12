import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { UpdateGhnPickupSettingsDto } from './dto/ghn-pickup-settings.dto';

const GHN_PICKUP_SETTING_KEY = 'shipping.ghn.pickup_address';

export interface GhnPickupSettings {
  provinceId?: number;
  districtId?: number;
  wardCode?: string;
  source: 'database' | 'env' | 'empty';
}

interface SettingRow {
  value: unknown;
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
}
