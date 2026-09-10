import { Body, Controller, Headers, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { buildApiResponse } from '../../../common/utils/api-response.util';
import { ShippingService } from '../shipping.service';

@ApiTags('Shipping Webhooks')
@Controller('webhooks/shipping/ghn')
export class GhnWebhookController {
  constructor(private readonly shippingService: ShippingService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'GHN shipping webhook' })
  async handleWebhook(
    @Req() req: Request,
    @Body() payload: Record<string, unknown>,
    @Headers() headers: Record<string, unknown>,
  ) {
    const data = await this.shippingService.handleGhnWebhook(payload, headers);
    return buildApiResponse(req, 'GHN_WEBHOOK_PROCESSED', 'GHN webhook processed', data);
  }
}
