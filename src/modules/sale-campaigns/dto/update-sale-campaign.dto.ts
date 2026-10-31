import { PartialType } from '@nestjs/swagger';
import { CreateSaleCampaignDto } from './create-sale-campaign.dto';

export class UpdateSaleCampaignDto extends PartialType(CreateSaleCampaignDto) {}
