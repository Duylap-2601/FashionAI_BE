import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { buildApiResponse } from '../../common/utils/api-response.util';
import { PinProductDto } from './dto/pin-product.dto';
import { RackService } from './rack.service';

@ApiTags('Rack')
@Controller('rack')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class RackController {
  constructor(private readonly rackService: RackService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pin một sản phẩm vào giá treo đồ (idempotent)' })
  async pin(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PinProductDto,
  ) {
    const data = await this.rackService.pin(user.id, dto.productId);
    return buildApiResponse(req, 'RACK_PIN_SUCCESS', 'Đã pin sản phẩm vào giá treo đồ', data);
  }

  @Get()
  @ApiOperation({ summary: 'Danh sách sản phẩm đã pin trong giá treo đồ' })
  async findAll(@Req() req: Request, @CurrentUser() user: AuthenticatedUser) {
    const data = await this.rackService.findAll(user.id);
    return buildApiResponse(req, 'RACK_LIST_SUCCESS', 'Lấy danh sách giá treo đồ thành công', data);
  }

  // Phải khai báo trước ':id' để 'all' không bị nhận thành id.
  @Delete('all')
  @ApiOperation({ summary: 'Bỏ toàn bộ sản phẩm khỏi giá treo đồ' })
  async unpinAll(@Req() req: Request, @CurrentUser() user: AuthenticatedUser) {
    const data = await this.rackService.unpinAll(user.id);
    return buildApiResponse(req, 'RACK_UNPIN_ALL_SUCCESS', `Đã bỏ ${data.deleted} sản phẩm khỏi giá treo đồ`, data);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Bỏ một sản phẩm khỏi giá treo đồ' })
  async unpin(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const data = await this.rackService.unpin(user.id, id);
    return buildApiResponse(req, 'RACK_UNPIN_SUCCESS', 'Đã bỏ sản phẩm khỏi giá treo đồ', data);
  }
}
