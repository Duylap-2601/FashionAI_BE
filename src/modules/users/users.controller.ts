import { Body, Controller, Get, Param, Patch, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpdateMeasurementsDto } from './dto/update-measurements.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateUserAdminDto } from './dto/update-user-admin.dto';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { buildApiResponse } from '../../common/utils/api-response.util';
import { UsersService } from './users.service';

type RequestUser = AuthenticatedUser;

@ApiTags('Users')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Lấy thông tin người dùng hiện tại' })
  async getMe(@Req() req: Request, @CurrentUser() user: RequestUser) {
    const data = await this.usersService.getMe(user.id);
    return buildApiResponse(
      req,
      'USER_PROFILE_SUCCESS',
      'Lấy thông tin người dùng thành công',
      data,
    );
  }

  @Put('me')
  @ApiOperation({ summary: 'Cập nhật hồ sơ người dùng' })
  async updateMe(
    @Req() req: Request,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateProfileDto,
  ) {
    const data = await this.usersService.updateMe(user.id, dto);
    return buildApiResponse(
      req,
      'USER_PROFILE_UPDATED',
      'Cập nhật hồ sơ thành công',
      data,
    );
  }

  @Get('me/measurements')
  @ApiOperation({ summary: 'Lấy số đo cơ thể' })
  async getMeasurements(@Req() req: Request, @CurrentUser() user: RequestUser) {
    const data = await this.usersService.getMeasurements(user.id);
    return buildApiResponse(
      req,
      'USER_MEASUREMENTS_SUCCESS',
      'Lấy số đo cơ thể thành công',
      data,
    );
  }

  @Put('me/measurements')
  @ApiOperation({ summary: 'Cập nhật số đo cơ thể' })
  async updateMeasurements(
    @Req() req: Request,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateMeasurementsDto,
  ) {
    const data = await this.usersService.updateMeasurements(user.id, dto);
    return buildApiResponse(
      req,
      'USER_MEASUREMENTS_UPDATED',
      'Cập nhật số đo cơ thể thành công',
      data,
    );
  }

  @Get('me/quota')
  @ApiOperation({ summary: 'Lấy quota AI hôm nay theo action' })
  async getQuota(
    @Req() req: Request,
    @CurrentUser() user: RequestUser,
    @Query('action') action?: string,
  ) {
    const data = await this.usersService.getQuota(user.id, action);
    return buildApiResponse(
      req,
      'USER_QUOTA_SUCCESS',
      'Lấy quota AI thành công',
      data,
    );
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Danh sách tất cả người dùng (Admin Only)' })
  async findAllAdmin(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.usersService.findAllAdmin(
      Number(page) || 1,
      Number(limit) || 20,
    );
    return buildApiResponse(
      req,
      'ADMIN_USERS_FETCH_SUCCESS',
      'Lấy danh sách người dùng thành công',
      result.items,
      result.meta,
    );
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Cập nhật thông tin người dùng (Admin Only)' })
  async updateByAdmin(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateUserAdminDto,
  ) {
    const data = await this.usersService.updateByAdmin(id, dto);
    return buildApiResponse(
      req,
      'ADMIN_USER_UPDATED',
      'Cập nhật thông tin người dùng thành công',
      data,
    );
  }
}
