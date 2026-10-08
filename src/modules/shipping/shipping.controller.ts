import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { buildApiResponse } from '../../common/utils/api-response.util';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CalculateShippingFeeDto } from './dto/calculate-shipping-fee.dto';
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

  @Post('calculate-fee')
  @ApiOperation({ summary: 'Tính phí vận chuyển qua backend' })
  async calculateFee(@Req() req: Request, @Body() dto: CalculateShippingFeeDto) {
    const data = await this.shippingService.calculateFee(dto);
    return buildApiResponse(req, 'SHIPPING_FEE_CALCULATED', 'Tính phí vận chuyển thành công', data);
  }

  @Get('provinces')
  @Public()
  async getProvinces(@Req() req: Request) {
    return buildApiResponse(req, 'SHIPPING_PROVINCES_FETCHED', 'Lấy danh sách tỉnh thành thành công', await this.shippingService.getProvinces());
  }

  @Get('districts')
  @Public()
  async getDistricts(@Req() req: Request, @Query('provinceId') provinceId: string) {
    return buildApiResponse(req, 'SHIPPING_DISTRICTS_FETCHED', 'Lấy danh sách quận huyện thành công', await this.shippingService.getDistricts(Number(provinceId)));
  }

  @Get('wards')
  @Public()
  async getWards(@Req() req: Request, @Query('districtId') districtId: string) {
    return buildApiResponse(req, 'SHIPPING_WARDS_FETCHED', 'Lấy danh sách phường xã thành công', await this.shippingService.getWards(Number(districtId)));
  }

  @Get('locations')
  @ApiOperation({ summary: 'Lấy danh sách Tỉnh/Thành, Quận/Huyện và Phường/Xã GHN legacy' })
  async getLocations(@Req() req: Request) {
    const data = await this.shippingService.getLocations();
    return buildApiResponse(req, 'SHIPPING_LOCATIONS_FETCHED', 'Lấy danh sách địa chỉ giao hàng thành công', data);
  }

  @Get('address-catalog/provinces')
  @Public()
  @ApiOperation({ summary: 'Lấy danh sách Tỉnh/Thành theo catalog revision' })
  async getAddressCatalogProvinces(@Req() req: Request, @Query('model') model: string | undefined, @Query('revision') revision: string) {
    const data = await this.shippingService.getAddressCatalogProvinces(this.shippingService.parseAddressModel(model), revision);
    return buildApiResponse(req, 'ADDRESS_CATALOG_PROVINCES_FETCHED', 'Lấy danh sách tỉnh thành thành công', data);
  }

  @Get('address-catalog/wards')
  @Public()
  @ApiOperation({ summary: 'Lấy danh sách Phường/Xã theo catalog revision' })
  async getAddressCatalogWards(
    @Req() req: Request,
    @Query('model') model: string | undefined,
    @Query('provinceId') provinceId: string,
    @Query('revision') revision: string,
  ) {
    const data = await this.shippingService.getAddressCatalogWards(this.shippingService.parseAddressModel(model), provinceId, revision);
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

  @Post('ghn-locations/sync-post-merger')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Admin trigger sync GHN master-data địa chỉ sau sáp nhập' })
  async syncGhnPostMergerLocations(@Req() req: Request) {
    const data = await this.ghnLocationSyncService.syncPostMerger('admin');
    return buildApiResponse(req, 'GHN_POST_MERGER_LOCATIONS_SYNC_TRIGGERED', 'Đã xử lý yêu cầu đồng bộ địa chỉ GHN sau sáp nhập', data);
  }
}
