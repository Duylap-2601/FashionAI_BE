import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { buildApiResponse } from '../../common/utils/api-response.util';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { CartService } from './cart.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { MergeCartDto } from './dto/merge-cart.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

@ApiTags('Cart')
@Controller('cart')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  @ApiOperation({ summary: 'Lấy giỏ hàng của user (đồng bộ giữa các thiết bị)' })
  async getCart(@Req() req: Request, @CurrentUser() user: AuthenticatedUser) {
    const data = await this.cartService.getCart(user.id);
    return buildApiResponse(req, 'CART_GET_SUCCESS', 'Lấy giỏ hàng thành công', data);
  }

  @Post('items')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Thêm sản phẩm vào giỏ, trùng sản phẩm/màu/loại combo thì cộng số lượng' })
  async addItem(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddCartItemDto,
  ) {
    const data = await this.cartService.addItem(user.id, dto);
    return buildApiResponse(req, 'CART_ADD_SUCCESS', 'Đã thêm sản phẩm vào giỏ hàng', data);
  }

  @Patch('items/:id')
  @ApiOperation({ summary: 'Đặt số lượng cuối cùng của một dòng trong giỏ' })
  async updateItem(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    const data = await this.cartService.updateQuantity(user.id, id, dto.quantity);
    return buildApiResponse(req, 'CART_UPDATE_SUCCESS', 'Đã cập nhật giỏ hàng', data);
  }

  @Delete('items/:id')
  @ApiOperation({ summary: 'Bỏ một dòng khỏi giỏ hàng' })
  async removeItem(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.cartService.removeItem(user.id, id);
    return buildApiResponse(req, 'CART_REMOVE_SUCCESS', 'Đã bỏ sản phẩm khỏi giỏ hàng', data);
  }

  @Delete()
  @ApiOperation({ summary: 'Xoá toàn bộ giỏ hàng' })
  async clear(@Req() req: Request, @CurrentUser() user: AuthenticatedUser) {
    const data = await this.cartService.clear(user.id);
    return buildApiResponse(req, 'CART_CLEAR_SUCCESS', 'Đã xoá giỏ hàng', data);
  }

  @Post('merge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Gộp giỏ khách (chưa đăng nhập) vào giỏ của user, món trùng lấy số lượng lớn hơn' })
  async merge(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MergeCartDto,
  ) {
    const data = await this.cartService.merge(user.id, dto);
    return buildApiResponse(req, 'CART_MERGE_SUCCESS', 'Đã gộp giỏ hàng', data);
  }
}
