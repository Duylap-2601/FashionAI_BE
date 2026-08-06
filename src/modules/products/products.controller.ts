import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Role } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateProductDto } from './dto/create-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { ProductsService } from './products.service';

@ApiTags('Products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Danh sách sản phẩm quần áo (có tìm kiếm, lọc & phân trang)' })
  async findAll(@Req() req: Request, @Query() query: QueryProductDto) {
    const result = await this.productsService.findAll(query);
    return {
      success: true,
      code: 'PRODUCTS_FETCH_SUCCESS',
      message: 'Lấy danh sách sản phẩm thành công',
      timestamp: new Date().toISOString(),
      path: req.originalUrl ?? req.url,
      data: result.items,
      meta: result.meta,
    };
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết sản phẩm theo ID' })
  async findOne(@Req() req: Request, @Param('id') id: string) {
    const data = await this.productsService.findOne(id);
    return {
      success: true,
      code: 'PRODUCT_FETCH_SUCCESS',
      message: 'Lấy thông tin sản phẩm thành công',
      timestamp: new Date().toISOString(),
      path: req.originalUrl ?? req.url,
      data,
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Tạo mới sản phẩm (Admin Only)' })
  async create(@Req() req: Request, @Body() dto: CreateProductDto) {
    const data = await this.productsService.create(dto);
    return {
      success: true,
      code: 'PRODUCT_CREATE_SUCCESS',
      message: 'Tạo mới sản phẩm thành công',
      timestamp: new Date().toISOString(),
      path: req.originalUrl ?? req.url,
      data,
    };
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Cập nhật thông tin sản phẩm (Admin Only)' })
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: Partial<CreateProductDto>,
  ) {
    const data = await this.productsService.update(id, dto);
    return {
      success: true,
      code: 'PRODUCT_UPDATE_SUCCESS',
      message: 'Cập nhật sản phẩm thành công',
      timestamp: new Date().toISOString(),
      path: req.originalUrl ?? req.url,
      data,
    };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Xóa sản phẩm (Admin Only)' })
  async remove(@Req() req: Request, @Param('id') id: string) {
    await this.productsService.remove(id);
    return {
      success: true,
      code: 'PRODUCT_DELETE_SUCCESS',
      message: 'Xóa sản phẩm thành công',
      timestamp: new Date().toISOString(),
      path: req.originalUrl ?? req.url,
      data: null,
    };
  }
}
