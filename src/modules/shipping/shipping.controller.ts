import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { buildApiResponse } from '../../common/utils/api-response.util';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CalculateShippingFeeDto } from './dto/calculate-shipping-fee.dto';
import { ShippingService } from './shipping.service';

@ApiTags('Shipping')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('shipping')
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

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
}
