import { HttpException } from '@nestjs/common';

export function toZaloPayAck(error: unknown | null) {
  if (!error) return { return_code: 1, return_message: 'success' };
  if (error instanceof HttpException && error.getStatus() >= 400 && error.getStatus() < 500) {
    return { return_code: 2, return_message: error.message };
  }
  throw error;
}
