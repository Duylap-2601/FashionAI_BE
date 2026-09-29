import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { buildApiResponse } from '../../common/utils/api-response.util';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { UpsertUserAddressDto } from './dto/user-address.dto';
import { UserAddressesService } from './user-addresses.service';

@ApiTags('User addresses')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('users/me/addresses')
export class UserAddressesController {
  constructor(private readonly addressesService: UserAddressesService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách địa chỉ giao hàng của tôi' })
  async findAll(@Req() req: Request, @CurrentUser() user: AuthenticatedUser) {
    const data = await this.addressesService.findAll(user.id);
    return buildApiResponse(req, 'USER_ADDRESSES_FETCH_SUCCESS', 'Lấy danh sách địa chỉ thành công', data);
  }

  @Post()
  @ApiOperation({ summary: 'Thêm địa chỉ giao hàng' })
  async create(@Req() req: Request, @CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertUserAddressDto) {
    const data = await this.addressesService.create(user.id, dto);
    return buildApiResponse(req, 'USER_ADDRESS_CREATED', 'Thêm địa chỉ thành công', data);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cập nhật địa chỉ giao hàng' })
  async update(@Req() req: Request, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpsertUserAddressDto) {
    const data = await this.addressesService.update(user.id, id, dto);
    return buildApiResponse(req, 'USER_ADDRESS_UPDATED', 'Cập nhật địa chỉ thành công', data);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Xóa địa chỉ giao hàng' })
  async remove(@Req() req: Request, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const data = await this.addressesService.remove(user.id, id);
    return buildApiResponse(req, 'USER_ADDRESS_DELETED', 'Xóa địa chỉ thành công', data);
  }

  @Patch(':id/default')
  @ApiOperation({ summary: 'Đặt địa chỉ mặc định' })
  async setDefault(@Req() req: Request, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const data = await this.addressesService.setDefault(user.id, id);
    return buildApiResponse(req, 'USER_ADDRESS_DEFAULT_UPDATED', 'Đặt địa chỉ mặc định thành công', data);
  }
}
