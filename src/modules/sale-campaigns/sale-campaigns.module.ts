import { Module } from '@nestjs/common';
import { SaleCampaignsController } from './sale-campaigns.controller';
import { SaleCampaignsService } from './sale-campaigns.service';
import { SalePricingService } from './sale-pricing.service';

@Module({
  controllers: [SaleCampaignsController],
  providers: [SaleCampaignsService, SalePricingService],
  exports: [SalePricingService],
})
export class SaleCampaignsModule {}
