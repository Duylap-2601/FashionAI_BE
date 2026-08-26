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
  UploadedFiles,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
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
import { buildApiResponse } from '../../common/utils/api-response.util';

@ApiTags('Products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Danh sách sản phẩm quần áo (có tìm kiếm, lọc & phân trang)' })
  async findAll(@Req() req: Request, @Query() query: QueryProductDto) {
    const result = await this.productsService.findAll(query);
    return buildApiResponse(
      req,
      'PRODUCTS_FETCH_SUCCESS',
      'Lấy danh sách sản phẩm thành công',
      result.items,
      result.meta,
    );
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết sản phẩm theo ID' })
  async findOne(@Req() req: Request, @Param('id') id: string) {
    const data = await this.productsService.findOne(id);
    return buildApiResponse(req, 'PRODUCT_FETCH_SUCCESS', 'Lấy thông tin sản phẩm thành công', data);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Tạo mới sản phẩm kèm upload nhiều ảnh (Admin Only)' })
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
        price: { type: 'number', example: 350000 },
        status: { type: 'string', enum: ['DRAFT', 'ACTIVE', 'ARCHIVED'] },
        garmentUrl: {
          type: 'string',
          description: 'URL ảnh nếu không upload file image',
        },
        images: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: 'Danh sách ảnh sản phẩm/garment (tối đa 10 ảnh). Ảnh đầu tiên làm ảnh chính.',
        },
      },
    },
  })
  @UseInterceptors(AnyFilesInterceptor())
  async create(
    @Req() req: Request,
    @Body() dto: CreateProductDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    // FE có thể gửi field "images" (số nhiều, đúng chuẩn) hoặc "image" (số ít, do
    // nhầm) — AnyFilesInterceptor nhận mọi fieldname nên chấp nhận cả hai, tránh
    // MulterError "Unexpected field" khi FE gửi sai tên field.
    const images = (files ?? []).filter(
      (f) => f.fieldname === 'images' || f.fieldname === 'image',
    );

    if (images.length > 0) {
      const filePipe = new FileValidationPipe({ maxSize: 10 * 1024 * 1024 });
      for (const image of images) {
        filePipe.transform(image);
      }
    }

    const data = await this.productsService.create(dto, images);
    return buildApiResponse(req, 'PRODUCT_CREATE_SUCCESS', 'Tạo mới sản phẩm thành công', data);
  }

  @Post(':id/images')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Upload nhiều ảnh sản phẩm (Admin Only)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['images'],
      properties: {
        images: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: 'Danh sách ảnh sản phẩm hoặc ảnh garment dùng cho Try-On (tối đa 10 ảnh)',
        },
        isMainIndex: {
          type: 'integer',
          default: 0,
          description: 'Chỉ số ảnh trong mảng sẽ làm ảnh chính (0-based index). Chỉ áp dụng nếu mảng có ít nhất 1 ảnh.',
        },
      },
    },
  })
  @UseInterceptors(AnyFilesInterceptor())
  async uploadImages(
    @Req() req: Request,
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body('isMainIndex') isMainIndex?: string | number,
  ) {
    const images = (files ?? []).filter(
      (f) => f.fieldname === 'images' || f.fieldname === 'image',
    );

    if (!images || images.length === 0) {
      throw new BadRequestException('Vui lòng upload ít nhất 1 ảnh sản phẩm');
    }

    const filePipe = new FileValidationPipe({ maxSize: 10 * 1024 * 1024 });
    for (const image of images) {
      filePipe.transform(image);
    }

    const mainIndex = typeof isMainIndex === 'string' ? parseInt(isMainIndex, 10) : (isMainIndex ?? 0);
    const data = await this.productsService.uploadProductImages(id, images, mainIndex);

    return buildApiResponse(
      req,
      'PRODUCT_IMAGES_UPLOAD_SUCCESS',
      'Upload ảnh sản phẩm thành công',
      data,
    );
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
    return buildApiResponse(req, 'PRODUCT_UPDATE_SUCCESS', 'Cập nhật sản phẩm thành công', data);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Xóa sản phẩm (Admin Only)' })
  async remove(@Req() req: Request, @Param('id') id: string) {
    await this.productsService.remove(id);
    return buildApiResponse(req, 'PRODUCT_DELETE_SUCCESS', 'Xóa sản phẩm thành công', null);
  }

  private parseBoolean(value: string | boolean | undefined) {
    if (typeof value === 'boolean') return value;
    if (!value) return false;
    return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
  }
}
