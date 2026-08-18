import {
  Body,
  Controller,
  Delete,
  BadRequestException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Role } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { FileValidationPipe } from '../../common/pipes/file-validation.pipe';
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
  @ApiOperation({ summary: 'Tạo mới sản phẩm kèm upload ảnh (Admin Only)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name', 'category', 'price'],
      properties: {
        name: { type: 'string', example: 'Áo sơ mi trắng premium' },
        description: { type: 'string' },
        category: { type: 'string', enum: ['UPPER', 'LOWER', 'FULL_BODY'] },
        color: { type: 'string', example: 'Trắng' },
        size: { type: 'string', example: 'L' },
        price: { type: 'number', example: 350000 },
        status: { type: 'string', enum: ['DRAFT', 'ACTIVE', 'ARCHIVED'] },
        garmentUrl: {
          type: 'string',
          description: 'URL ảnh nếu không upload file image',
        },
        image: {
          type: 'string',
          format: 'binary',
          description: 'Ảnh sản phẩm/garment. Nếu có image thì backend tự upload và set garmentUrl.',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('image'))
  async create(
    @Req() req: Request,
    @Body() dto: CreateProductDto,
    @UploadedFile() image?: Express.Multer.File,
  ) {
    if (image) {
      const filePipe = new FileValidationPipe({ maxSize: 10 * 1024 * 1024 });
      filePipe.transform(image);
    }

    const data = await this.productsService.create(dto, image);
    return {
      success: true,
      code: 'PRODUCT_CREATE_SUCCESS',
      message: 'Tạo mới sản phẩm thành công',
      timestamp: new Date().toISOString(),
      path: req.originalUrl ?? req.url,
      data,
    };
  }

  @Post(':id/images')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Upload ảnh sản phẩm (Admin Only)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description: 'Ảnh sản phẩm hoặc ảnh garment dùng cho Try-On',
        },
        isMain: {
          type: 'boolean',
          default: false,
          description: 'Nếu true, ảnh này trở thành ảnh chính và cập nhật garmentUrl',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('image'))
  async uploadImage(
    @Req() req: Request,
    @Param('id') id: string,
    @UploadedFile() image: Express.Multer.File,
    @Body('isMain') isMain?: string | boolean,
  ) {
    if (!image) {
      throw new BadRequestException('Vui lòng upload ảnh sản phẩm');
    }

    const filePipe = new FileValidationPipe({ maxSize: 10 * 1024 * 1024 });
    filePipe.transform(image);

    const data = await this.productsService.uploadProductImage(
      id,
      image,
      this.parseBoolean(isMain),
    );

    return {
      success: true,
      code: 'PRODUCT_IMAGE_UPLOAD_SUCCESS',
      message: 'Upload ảnh sản phẩm thành công',
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

  private parseBoolean(value: string | boolean | undefined) {
    if (typeof value === 'boolean') return value;
    if (!value) return false;
    return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
  }
}
