-- Trạng thái vận chuyển đơn hàng cho admin (thêm vao enum OrderStatus hien co)
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'CONFIRMED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'SHIPPING';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'RETURNED';