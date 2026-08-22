import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const ORDER_CODE_MAX_ATTEMPTS = 5;

/**
 * Sinh orderCode 8 chữ số: 6 số cuối của timestamp + 2 số random.
 * Giữ độ dài ổn định để cổng thanh toán luôn nhận được cùng một định dạng.
 */
export function generateOrderCode(): number {
  const tail = String(Date.now()).slice(-6);
  const random = Math.floor(Math.random() * 100)
    .toString()
    .padStart(2, '0');
  return Number(`${tail}${random}`);
}

/**
 * `orders.order_code` là unique nên hai request trong cùng một millisecond có thể
 * trùng code. Thử lại với code mới thay vì để P2002 lọt ra client.
 */
export async function createWithUniqueOrderCode<T>(
  create: (orderCode: number) => Promise<T>,
  attempts = ORDER_CODE_MAX_ATTEMPTS,
): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await create(generateOrderCode());
    } catch (error) {
      if (!isOrderCodeConflict(error)) {
        throw error;
      }
    }
  }

  throw new ConflictException(
    'Không thể tạo mã đơn hàng duy nhất. Vui lòng thử lại.',
  );
}

function isOrderCodeConflict(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return false;
  }

  const target = (error.meta as { target?: string[] | string } | undefined)
    ?.target;
  const fields = Array.isArray(target) ? target.join(',') : target ?? '';
  return fields.includes('order_code') || fields.includes('orderCode');
}
