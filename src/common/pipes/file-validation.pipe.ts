import {
  PipeTransform,
  Injectable,
  BadRequestException,
} from '@nestjs/common';

export interface FileValidationOptions {
  maxSize?: number; // bytes
  allowedMimeTypes?: string[];
}

@Injectable()
export class FileValidationPipe implements PipeTransform {
  private readonly maxSize: number;
  private readonly allowedMimeTypes: string[];

  constructor(options?: FileValidationOptions) {
    this.maxSize = options?.maxSize ?? 10 * 1024 * 1024; // 10MB default
    this.allowedMimeTypes = options?.allowedMimeTypes ?? [
      'image/jpeg',
      'image/png',
      'image/webp',
    ];
  }

  transform(file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('File tải lên không được để trống');
    }

    if (file.size > this.maxSize) {
      const maxMb = (this.maxSize / (1024 * 1024)).toFixed(1);
      throw new BadRequestException(
        `Kích thước file vượt quá giới hạn cho phép (${maxMb}MB)`,
      );
    }

    if (!this.allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Định dạng file không hỗ trợ (${file.mimetype}). Các định dạng cho phép: ${this.allowedMimeTypes.join(', ')}`,
      );
    }

    return file;
  }
}
