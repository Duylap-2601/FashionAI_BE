import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private isCloudinaryConfigured = false;

  constructor(private readonly configService: ConfigService) {
    const cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.configService.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.configService.get<string>('CLOUDINARY_API_SECRET');

    if (cloudName && apiKey && apiSecret) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
      });
      this.isCloudinaryConfigured = true;
      this.logger.log('Cloudinary storage successfully initialized');
    } else {
      this.logger.warn('Cloudinary credentials missing. Images will return pass-through URLs.');
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

    // Fallback: convert to base64 Data URL or return mock URL for testing
    const base64 = fileBuffer.toString('base64');
    return `data:image/png;base64,${base64}`;
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
