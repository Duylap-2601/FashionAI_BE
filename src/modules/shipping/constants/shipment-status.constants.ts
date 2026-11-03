import { ShipmentStatus } from '@prisma/client';

// GHN chỉ cho hủy vận đơn trước khi shipper lấy hàng (ready_to_pick, picking,
// money_collect_picking). PENDING/FAILED là vận đơn chưa tạo được trên GHN.
export const SHIPMENT_CANCELLABLE_STATUSES: ShipmentStatus[] = [
  ShipmentStatus.PENDING,
  ShipmentStatus.FAILED,
  ShipmentStatus.CREATED,
  ShipmentStatus.READY_TO_PICK,
  ShipmentStatus.PICKING,
];

export const SHIPMENT_NOT_CANCELLABLE_MESSAGE = 'Đơn vị vận chuyển đã lấy hàng, không thể hủy vận đơn.';
