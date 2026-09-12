import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { buildApiResponse } from '../../../common/utils/api-response.util';
import { ShippingService } from '../shipping.service';
import { ShippingProviderType } from '../constants/shipping-provider.enum';
import { SimulateShipmentStatusDto } from '../dto/simulate-shipment-status.dto';

@ApiTags('Shipping Staging Simulator')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('internal/staging/shipments')
export class StagingSimulatorController {
  constructor(private readonly shippingService: ShippingService) {}

  @Post(':shipmentId/status')
  @ApiOperation({ summary: 'Simulate shipment status change (staging only)' })
  async simulateStatus(
    @Req() req: Request,
    @Param('shipmentId') shipmentId: string,
    @Body() dto: SimulateShipmentStatusDto,
  ) {
    const eventKey = `SIM:${shipmentId}:${dto.status}:${Date.now()}`;

    const result = await this.shippingService.handleShippingStatus({
      provider: ShippingProviderType.GHN,
      shipmentId,
      shipmentStatus: dto.status,
      rawStatus: dto.status,
      eventKey,
      eventType: 'simulated_status',
      payload: { simulated: true, status: dto.status, reason: dto.reason },
      source: 'STAGING_SIMULATOR',
    });

    return buildApiResponse(req, 'SHIPMENT_STATUS_SIMULATED', 'Trạng thái vận chuyển đã được giả lập', result);
  }
}
