import { OrderStatus, ShipmentStatus } from '@prisma/client';

// Vận đơn đã rời shop: đơn coi như đang giao. Giao thất bại / GHN hoàn hàng vẫn
// giữ "Đang giao" (vận đơn được gắn cờ sự cố để admin xử lý), không tự chuyển sang
// luồng hoàn trả của khách vì luồng đó gắn với hoàn tiền.
const SHIPMENT_LEFT_SHOP: ShipmentStatus[] = [
  ShipmentStatus.PICKED,
  ShipmentStatus.SHIPPING,
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.DELIVERING,
  ShipmentStatus.DELIVERY_FAILED,
  ShipmentStatus.RETURNING,
  ShipmentStatus.RETURNED,
];

/**
 * Trạng thái đơn đi theo trạng thái vận đơn GHN: đã lấy hàng → SHIPPING, đã giao →
 * DELIVERED (khách vẫn bấm "Tôi đã nhận hàng" để sang COMPLETED). Chỉ đi tiến từ
 * READY_TO_SHIP/SHIPPING; đơn đã hủy, hoàn tất hay đang đổi trả thì giữ nguyên.
 * Trả về null khi không cần đổi.
 */
export function orderStatusForShipment(orderStatus: OrderStatus, shipmentStatus: ShipmentStatus): OrderStatus | null {
  if (shipmentStatus === ShipmentStatus.DELIVERED) {
    return orderStatus === OrderStatus.READY_TO_SHIP || orderStatus === OrderStatus.SHIPPING ? OrderStatus.DELIVERED : null;
  }
  if (SHIPMENT_LEFT_SHOP.includes(shipmentStatus)) {
    return orderStatus === OrderStatus.READY_TO_SHIP ? OrderStatus.SHIPPING : null;
  }
  return null;
}
