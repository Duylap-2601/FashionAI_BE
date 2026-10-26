import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { buildApiResponse } from '../../common/utils/api-response.util';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DeviceTokenService } from './device-token.service';
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto';
import { UnregisterDeviceTokenDto } from './dto/unregister-device-token.dto';

@ApiTags('Device Tokens')
@Controller('device-tokens')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class DeviceTokenController {
  constructor(private readonly deviceTokenService: DeviceTokenService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng ký Expo push token của thiết bị (idempotent)' })
  async register(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterDeviceTokenDto,
  ) {
    const data = await this.deviceTokenService.register(
      user.id,
      dto.token,
      dto.platform,
    );
    return buildApiResponse(
      req,
      'DEVICE_TOKEN_REGISTERED',
      'Đã đăng ký thiết bị nhận thông báo',
      data,
    );
  }

  @Delete()
  @ApiOperation({ summary: 'Xoá push token khi đăng xuất' })
  async unregister(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UnregisterDeviceTokenDto,
  ) {
    const data = await this.deviceTokenService.unregister(user.id, dto.token);
    return buildApiResponse(
      req,
      'DEVICE_TOKEN_UNREGISTERED',
      'Đã huỷ đăng ký nhận thông báo trên thiết bị',
      data,
    );
  }
}
