import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpdateMeasurementsDto } from './dto/update-measurements.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { UsersService } from './users.service';

type RequestUser = AuthenticatedUser;

@ApiTags('Users')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Lấy thông tin user hiện tại' })
  getMe(@CurrentUser() user: RequestUser) {
    return this.usersService.getMe(user.id);
  }

  @Put('me')
  @ApiOperation({ summary: 'Cập nhật profile' })
  updateMe(@CurrentUser() user: RequestUser, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateMe(user.id, dto);
  }

  @Get('me/measurements')
  @ApiOperation({ summary: 'Lấy số đo cơ thể' })
  getMeasurements(@CurrentUser() user: RequestUser) {
    return this.usersService.getMeasurements(user.id);
  }

  @Put('me/measurements')
  @ApiOperation({ summary: 'Cập nhật số đo cơ thể' })
  updateMeasurements(
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateMeasurementsDto,
  ) {
    return this.usersService.updateMeasurements(user.id, dto);
  }

  @Get('me/quota')
  @ApiOperation({ summary: 'Lấy quota AI hôm nay theo action (TRY_ON | STYLIST | CHATBOT)' })
  getQuota(@CurrentUser() user: RequestUser, @Query('action') action?: string) {
    return this.usersService.getQuota(user.id, action);
  }
}
