import { ApiProperty } from '@nestjs/swagger';

export class ApiResponseDto<T = any> {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 200 })
  statusCode: number;

  @ApiProperty({ example: 'SUCCESS' })
  code: string;

  @ApiProperty({ example: 'Thành công' })
  message: string;

  @ApiProperty({ example: '/api/example', required: false })
  path?: string;

  @ApiProperty()
  data?: T;

  @ApiProperty({ required: false })
  details?: any;

  @ApiProperty({ example: '2026-08-01T00:00:00.000Z' })
  timestamp: string;

  constructor(
    success: boolean,
    statusCode: number,
    code: string,
    message: string,
    data?: T,
    details?: any,
    path?: string,
  ) {
    this.success = success;
    this.statusCode = statusCode;
    this.code = code;
    this.message = message;
    this.data = data;
    this.details = details;
    this.path = path;
    this.timestamp = new Date().toISOString();
  }

  static success<T>(
    data: T,
    message = 'Thành công',
    code = 'SUCCESS',
    statusCode = 200,
  ): ApiResponseDto<T> {
    return new ApiResponseDto(true, statusCode, code, message, data);
  }

  static error(
    message: string,
    code = 'ERROR',
    statusCode = 500,
    details?: any,
    path?: string,
  ): ApiResponseDto<null> {
    return new ApiResponseDto(false, statusCode, code, message, null, details, path);
  }
}
