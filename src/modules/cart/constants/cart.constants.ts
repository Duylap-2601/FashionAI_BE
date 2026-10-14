// Khớp giới hạn của CreateOrderDto: cả giỏ phải đặt được trong một đơn.
export const CART_MAX_LINES = 50;
export const CART_MAX_QUANTITY = 1000;

// Socket event báo các thiết bị khác của user tải lại giỏ hàng.
export const CART_UPDATED_EVENT = 'cart:updated';
