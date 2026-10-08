import { Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { buildApiResponse } from '../../common/utils/api-response.util';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GhnLocationSyncService } from './ghn-location-sync.service';
import { ShippingService } from './shipping.service';

@ApiTags('Shipping')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('shipping')
export class ShippingController {
  constructor(
    private readonly shippingService: ShippingService,
    private readonly ghnLocationSyncService: GhnLocationSyncService,
  ) {}

  @Get('address-catalog/provinces')
  @Public()
  @ApiOperation({ summary: 'Lấy danh sách Tỉnh/Thành theo catalog revision' })
  async getAddressCatalogProvinces(@Req() req: Request, @Query('revision') revision: string) {
    const data = await this.shippingService.getAddressCatalogProvinces(revision);
    return buildApiResponse(req, 'ADDRESS_CATALOG_PROVINCES_FETCHED', 'Lấy danh sách tỉnh thành thành công', data);
  }

  @Get('address-catalog/wards')
  @Public()
  @ApiOperation({ summary: 'Lấy danh sách Phường/Xã theo catalog revision' })
  async getAddressCatalogWards(
    @Req() req: Request,
    @Query('provinceId') provinceId: string,
    @Query('revision') revision: string,
  ) {
    const data = await this.shippingService.getAddressCatalogWards(provinceId, revision);
    return buildApiResponse(req, 'ADDRESS_CATALOG_WARDS_FETCHED', 'Lấy danh sách phường xã thành công', data);
  }

  @Get('capabilities')
  @Public()
  @ApiOperation({ summary: 'Lấy capability địa chỉ/vận chuyển hiện tại' })
  async getCapabilities(@Req() req: Request) {
    return buildApiResponse(req, 'SHIPPING_CAPABILITIES_FETCHED', 'Lấy capability giao hàng thành công', await this.shippingService.getCapabilities());
  }

  @Post('ghn-locations/sync')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Admin trigger sync GHN master-data địa chỉ' })
  async syncGhnLocations(@Req() req: Request) {
    const data = await this.ghnLocationSyncService.sync('admin');
    return buildApiResponse(req, 'GHN_LOCATIONS_SYNC_TRIGGERED', 'Đã xử lý yêu cầu đồng bộ địa chỉ GHN', data);
  }
}
