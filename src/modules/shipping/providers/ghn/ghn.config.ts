import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface IGhnConfig {
  baseUrl: string;
  token: string;
  shopId: string;
  fromDistrictId: number;
  fromWardCode: string;
  webhookSecret?: string;
}

export function getGhnConfig(configService: ConfigService): IGhnConfig {
  const token = configService.get<string>('GHN_TOKEN');
  const shopId = configService.get<string>('GHN_SHOP_ID');
  const fromDistrictId = Number(configService.get<string>('GHN_FROM_DISTRICT_ID'));
  const fromWardCode = configService.get<string>('GHN_FROM_WARD_CODE');

  if (!token || !shopId || !Number.isFinite(fromDistrictId) || !fromWardCode) {
    throw new BadRequestException('GHN configuration is missing. Configure GHN_TOKEN, GHN_SHOP_ID, GHN_FROM_DISTRICT_ID and GHN_FROM_WARD_CODE.');
  }

  return {
    baseUrl: configService.get<string>('GHN_BASE_URL', 'https://dev-online-gateway.ghn.vn'),
    token,
    shopId,
    fromDistrictId,
    fromWardCode,
    webhookSecret: configService.get<string>('GHN_WEBHOOK_SECRET'),
  };
}
