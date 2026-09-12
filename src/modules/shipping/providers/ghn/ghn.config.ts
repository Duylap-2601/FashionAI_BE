import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface IGhnConfig {
  baseUrl: string;
  token: string;
  shopId: string;
  fromDistrictId?: number;
  fromWardCode?: string;
  webhookSecret?: string;
}

export function getGhnConfig(configService: ConfigService): IGhnConfig {
  const token = configService.get<string>('GHN_TOKEN');
  const shopId = configService.get<string>('GHN_SHOP_ID');
  const fromDistrictId = Number(configService.get<string>('GHN_FROM_DISTRICT_ID'));
  const fromWardCode = configService.get<string>('GHN_FROM_WARD_CODE') ?? configService.get<string>('GHN_FROM_WARD_ID');

  if (!token || !shopId) {
    throw new BadRequestException('GHN configuration is missing. Configure GHN_TOKEN and GHN_SHOP_ID.');
  }

  return {
    baseUrl: configService.get<string>('GHN_BASE_URL', 'https://dev-online-gateway.ghn.vn'),
    token,
    shopId,
    fromDistrictId: Number.isFinite(fromDistrictId) && fromDistrictId > 0 ? fromDistrictId : undefined,
    fromWardCode: fromWardCode?.trim() || undefined,
    webhookSecret: configService.get<string>('GHN_WEBHOOK_SECRET'),
  };
}
