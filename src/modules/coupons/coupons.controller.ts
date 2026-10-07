import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { buildApiResponse } from '../../common/utils/api-response.util';
import { CouponsService } from './coupons.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { QueryCouponDto } from './dto/query-coupon.dto';

@ApiTags('Coupons')
@Controller('coupons')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth('access-token')
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Tạo mã giảm giá mới (Admin Only)' })
  async create(@Req() req: Request, @Body() dto: CreateCouponDto) {
    const data = await this.couponsService.create(dto);
    return buildApiResponse(req, 'COUPON_CREATE_SUCCESS', 'Tạo mã giảm giá thành công', data);
  }

  @Get()
  @ApiOperation({ summary: 'Danh sách mã giảm giá (Admin Only)' })
  async findAll(@Req() req: Request, @Query() query: QueryCouponDto) {
    const result = await this.couponsService.findAll(query);
    return buildApiResponse(req, 'COUPONS_FETCH_SUCCESS', 'Lấy danh sách mã giảm giá thành công', result.items, result.meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết mã giảm giá (Admin Only)' })
  async findOne(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const data = await this.couponsService.findOne(id);
    return buildApiResponse(req, 'COUPON_FETCH_SUCCESS', 'Lấy thông tin mã giảm giá thành công', data);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cập nhật mã giảm giá (Admin Only)' })
  async update(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCouponDto) {
    const data = await this.couponsService.update(id, dto);
    return buildApiResponse(req, 'COUPON_UPDATE_SUCCESS', 'Cập nhật mã giảm giá thành công', data);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Xóa mã giảm giá (Admin Only)' })
  async remove(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const data = await this.couponsService.remove(id);
    return buildApiResponse(req, 'COUPON_DELETE_SUCCESS', 'Xóa mã giảm giá thành công', data);
  }
}
