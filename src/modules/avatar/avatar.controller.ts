import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AvatarService } from './avatar.service';
import { GenerateAvatarDto } from './dto/generate-avatar.dto';

@ApiTags('Avatar 3D')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('avatar')
export class AvatarController {
  constructor(private readonly avatarService: AvatarService) {}

  @Post('generate')
  @ApiOperation({
    summary: 'Tạo avatar 3D (GLB) từ số đo cơ thể bằng Blender pipeline',
    description: `Chạy Blender headless + MPFB2 để sinh mannequin 3D theo số đo.\n\n- Kết quả được cache theo hash số đo (cùng số đo → trả ngay, không chạy lại Blender).\n- Mất ~2 giây cho lần đầu, lần sau trả cache.\n- \`glbUrl\` là link Cloudinary (production) hoặc endpoint nội bộ (local dev).`,
  })
  @ApiResponse({ status: 201, description: 'Tạo avatar thành công' })
  @ApiResponse({ status: 503, description: 'Blender chưa được cấu hình hoặc đang tạo trùng' })
  async generate(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateAvatarDto,
  ) {
    const result = await this.avatarService.generate(user.id, dto);
    return {
      success: true,
      code: result.isCached ? 'AVATAR_CACHE_HIT' : 'AVATAR_GENERATED',
      message: result.isCached
        ? 'Lấy avatar từ cache'
        : 'Tạo avatar 3D thành công',
      timestamp: new Date().toISOString(),
      path: req.originalUrl ?? req.url,
      data: result,
    };
  }

  @Get('me')
  @ApiOperation({ summary: 'Lấy avatar 3D mới nhất của user hiện tại' })
  async getLatest(@Req() req: Request, @CurrentUser() user: AuthenticatedUser) {
    const data = await this.avatarService.getLatest(user.id);
    return {
      success: true,
      code: 'AVATAR_FETCH_SUCCESS',
      message: data ? 'Lấy avatar thành công' : 'Chưa có avatar nào',
      timestamp: new Date().toISOString(),
      path: req.originalUrl ?? req.url,
      data,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Lấy thông tin avatar theo ID' })
  async getById(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const data = await this.avatarService.getById(user.id, id);
    return {
      success: true,
      code: 'AVATAR_FETCH_SUCCESS',
      message: 'Lấy avatar thành công',
      timestamp: new Date().toISOString(),
      path: req.originalUrl ?? req.url,
      data,
    };
  }

  @Get(':name/file')
  @ApiOperation({
    summary: 'Tải file GLB (dùng khi avatar lưu local, chưa cấu hình Cloudinary)',
    description: 'Trả file model/gltf-binary để FE load vào Three.js viewer.',
  })
  async getFile(@Param('name') name: string) {
    return this.avatarService.streamFile(name);
  }
}
