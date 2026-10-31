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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { buildApiResponse } from '../../common/utils/api-response.util';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateSaleCampaignDto } from './dto/create-sale-campaign.dto';
import { QuerySaleCampaignDto } from './dto/query-sale-campaign.dto';
import { UpdateSaleCampaignDto } from './dto/update-sale-campaign.dto';
import { SaleCampaignsService } from './sale-campaigns.service';

@ApiTags('Sale Campaigns')
@Controller('sale-campaigns')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth('access-token')
export class SaleCampaignsController {
  constructor(private readonly saleCampaignsService: SaleCampaignsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Tạo chiến dịch sale (Admin Only)' })
  async create(@Req() req: Request, @Body() dto: CreateSaleCampaignDto) {
    const data = await this.saleCampaignsService.create(dto);
    return buildApiResponse(req, 'SALE_CAMPAIGN_CREATE_SUCCESS', 'Tạo chiến dịch sale thành công', data);
  }

  @Get()
  @ApiOperation({ summary: 'Danh sách chiến dịch sale (Admin Only)' })
  async findAll(@Req() req: Request, @Query() query: QuerySaleCampaignDto) {
    const result = await this.saleCampaignsService.findAll(query);
    return buildApiResponse(
      req,
      'SALE_CAMPAIGNS_FETCH_SUCCESS',
      'Lấy danh sách chiến dịch sale thành công',
      result.items,
      result.meta,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết chiến dịch sale (Admin Only)' })
  async findOne(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const data = await this.saleCampaignsService.findOne(id);
    return buildApiResponse(req, 'SALE_CAMPAIGN_FETCH_SUCCESS', 'Lấy thông tin chiến dịch sale thành công', data);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cập nhật chiến dịch sale (Admin Only)' })
  async update(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSaleCampaignDto,
  ) {
    const data = await this.saleCampaignsService.update(id, dto);
    return buildApiResponse(req, 'SALE_CAMPAIGN_UPDATE_SUCCESS', 'Cập nhật chiến dịch sale thành công', data);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Xóa chiến dịch sale (Admin Only)' })
  async remove(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const data = await this.saleCampaignsService.remove(id);
    return buildApiResponse(req, 'SALE_CAMPAIGN_DELETE_SUCCESS', 'Xóa chiến dịch sale thành công', data);
  }
}
