import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';

/**
 * Ảnh fallback được nhúng base64 vào DB, nên chỉ cho phép với file nhỏ. Vượt ngưỡng
 * này thì báo lỗi cấu hình thay vì âm thầm ghi vài MB text vào Postgres.
 */
const FALLBACK_MAX_BYTES = 256 * 1024;

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private isCloudinaryConfigured = false;
  private readonly isProduction: boolean;

  constructor(private readonly configService: ConfigService) {
    const cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.configService.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.configService.get<string>('CLOUDINARY_API_SECRET');
    this.isProduction = this.configService.get<string>('NODE_ENV') === 'production';

    if (cloudName && apiKey && apiSecret) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
      });
      this.isCloudinaryConfigured = true;
      this.logger.log('Cloudinary storage successfully initialized');
    } else if (this.isProduction) {
      throw new Error(
        'CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY và CLOUDINARY_API_SECRET là bắt buộc khi NODE_ENV=production.',
      );
    } else {
      this.logger.warn(
        'Cloudinary credentials missing. Ảnh nhỏ sẽ trả về data URL (chỉ dùng cho local/test).',
      );
    }
  }

  async uploadImage(fileBuffer: Buffer, folder = 'fashionai', fileName?: string): Promise<string> {
    if (this.isCloudinaryConfigured) {
      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder,
            public_id: fileName ? fileName.replace(/\.[^/.]+$/, '') : undefined,
            resource_type: 'image',
          },
          (error: any, result: any) => {
            if (error) {
              this.logger.error(`Cloudinary upload failed: ${error.message}`);
              return reject(error);
            }
            resolve(result?.secure_url || result?.url || '');
          },
        );
        uploadStream.end(fileBuffer);
      });
    }

    // Fallback cho môi trường local chưa cấu hình Cloudinary.
    if (fileBuffer.length > FALLBACK_MAX_BYTES) {
      throw new ServiceUnavailableException(
        `Ảnh ${(fileBuffer.length / 1024).toFixed(0)}KB vượt giới hạn fallback ` +
          `${FALLBACK_MAX_BYTES / 1024}KB. Vui lòng cấu hình Cloudinary (CLOUDINARY_CLOUD_NAME, ` +
          'CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET).',
      );
    }

    this.logger.warn(
      `Trả về data URL cho ảnh ${(fileBuffer.length / 1024).toFixed(0)}KB vì chưa cấu hình Cloudinary.`,
    );
    return `data:image/png;base64,${fileBuffer.toString('base64')}`;
  }

  async uploadUrl(imageUrl: string, folder = 'fashionai'): Promise<string> {
    if (this.isCloudinaryConfigured) {
      try {
        const result = await cloudinary.uploader.upload(imageUrl, {
          folder,
          resource_type: 'image',
        });
        return result.secure_url || result.url;
      } catch (err: any) {
        this.logger.error(`Cloudinary upload URL failed: ${err.message}`);
      }
    }
    return imageUrl;
  }
}
