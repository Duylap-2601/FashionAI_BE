# Audit — FLW-001

Phạm vi: toàn bộ chain `US → AC → BR → SCR → TC → EXEC → BUG` trong bộ tài liệu này.
Không sửa source code khi audit; chỉ đọc `FashionAI_BE` và `FashionAI_FE`.

## 1. Findings

| Severity | Check | Finding | Evidence | Required action |
|---|---|---|---|---|
| Critical | Intent/Forward | BUG-002: SePay checkout gửi `ORD-<code>`, IPN/bank webhook chỉ parse `FAI<code>` ⇒ thanh toán SePay không tự xác nhận | `BE src/modules/payments/payments.service.ts:createSePayCheckoutLink:290`, `:parseSePayOrderCode:1402`, `:parseSePayPaymentCode:1406` | Sửa parser/prefix + test hồi quy; chặn release SePay |
| High | Intent | BUG-001: SRS cam kết COD + trừ/hoàn kho; code không có stock và từ chối COD | `SRS.md:219`, `BE src/modules/orders/orders.service.ts:create:175`, `BE prisma/schema.prisma:Product:506` | Cập nhật SRS hoặc mở story COD/kho; không dùng SRS làm tiêu chí nghiệm thu nguyên trạng |
| High | Forward (execution) | 33/50 TC `Not Run`, gồm toàn bộ UI, webhook thật, cổng sandbox | `07-report.md` §3 | Chạy E2E staging cho TC-016, 023…026, 032, 037…040; thêm `EXEC` mới |
| Medium | Consistency | BR-014 bị bỏ qua ở 4 luồng ghi trực tiếp (payment, shipping, confirm-delivery, dispute) | `BE src/modules/shipping/shipping.service.ts:handleShippingStatus:338`, `BE src/modules/payments/payments.service.ts:processOrderSuccess:1547`, `BE src/modules/orders/orders.service.ts:confirmDelivery:1578` | Chốt state machine theo actor; thêm test đối chiếu map với mọi writer |
| Medium | Consistency | Cổng báo hủy để `paymentStatus = PENDING` trên đơn CANCELLED | `BE src/modules/payments/payments.service.ts:markOrderCancelled:1415` | Dùng chung helper cancel/expire; test |
| Medium | Intent/Audit | Admin ghi đè được `OrderEvent.source` | `BE src/modules/orders/dto/update-order-status.dto.ts:33` | Bỏ `source` khỏi DTO |
| Medium | Security | `GHN_WEBHOOK_SECRET` optional ⇒ webhook công khai không xác thực | `BE src/modules/shipping/shipping.service.ts:verifyWebhookSecret:404` | Fail-closed ở production |
| Medium | Config | `PAYMENT_DEFAULT_PROVIDER` không đặt ⇒ rơi vào MOMO, provider không có trên UI | `BE src/modules/payments/gateways/payment-gateway.registry.ts:constructor:18` | Đổi default hoặc bắt buộc `provider`; validate env lúc boot |
| Medium | Intent/UX | `/orders/[id]/success` hiển thị trạng thái/mã đơn/banner giả | `FE src/features/orders/components/orders-id-success-page.tsx:46` | Nối dữ liệu thật hoặc bỏ route |
| Medium | Ambiguity | Bỏ trống `refundShipping` tự hoàn phí ship với lỗi shop | `BE src/modules/order-issues/order-issues.service.ts:review:495` | Làm quyết định tường minh + ghi API docs |
| Medium | Consistency | Hủy vận đơn không đổi trạng thái đơn, không báo khách | `BE src/modules/shipping/admin-shipments.service.ts:cancel:123` | Chốt trạng thái sau hủy + notification |
| Medium | Consistency | `GET /orders/:id/tracking` ghi shipment không qua handler chuẩn | `BE src/modules/orders/orders.service.ts:getTracking:1761` | Read-only hoặc gọi `handleShippingStatus` |
| Medium | Scope | Subscription dùng chung `Order`/webhook, chưa có bộ traceability riêng | `BE src/modules/payments/subscription.service.ts` | Tạo FLW riêng (OQ-004) |
| Low | Consistency | `OrderQuote`, `ShipmentCreationState`, cột idempotency không được ghi/đọc | `BE prisma/schema.prisma:OrderQuote:409`, `:ShipmentCreationState:179`, `:OrderIdempotencyKey:310` | Xoá hoặc hoàn thiện + ADR |
| Low | Consistency | Nhiều `OrderStatus` không có writer; `CANONICAL_ORDER_STATUSES` thiếu 4 giá trị | `BE src/modules/orders/constants/order-flow.constants.ts:CANONICAL_ORDER_STATUSES:149` | Dọn enum/danh sách sau migration |
| Low | Audit | `signatureValid`/`WebhookEvent.status` gây hiểu nhầm với event bị bỏ qua | `BE src/modules/shipping/shipping.service.ts:handleShippingStatus:285` | Ghi đúng trạng thái/validity |
| Low | Validation | Không chặn số ảnh issue (Swagger ghi 10) | `BE src/modules/order-issues/order-issues.controller.ts:create:101` | Thêm guard số file |
| Low | Error handling | Lỗi tải địa chỉ bị hiển thị thành “chưa có địa chỉ” | `FE src/features/checkout/components/checkout-page.tsx:CheckoutPage:87` | Đọc `isError`, render lỗi |
| Low | Consistency | `/payment/cancel|error` tĩnh, không phân biệt pending/expired | `FE src/features/payments/components/payment-cancel-page.tsx:5` | Truy vấn trạng thái đơn |
| Low | API hygiene | DTO nhận `discountAmount`/`shippingFee` nhưng bỏ qua | `BE src/modules/orders/dto/create-order.dto.ts:156` | Xoá khỏi DTO |
| Low | Dead code | `createShipmentFromOrder` không có caller; outbox shipment job no-op | `BE src/modules/shipping/shipment.service.ts:41`, `BE src/modules/outbox/processors/outbox.processor.ts:60` | Xoá hoặc hoàn thiện producer |
| Low | Structure | `GET /order-issues/mine` nằm trong admin controller | `BE src/modules/order-issues/admin-order-issues.controller.ts:65` | Chuyển sang controller khách |
| Low | Naming | `DeliveryOptions` là chọn thanh toán; `PaymentMethodSelector` là ô coupon; `ShippingAddressForm` không dùng | `FE src/features/checkout/components/*` | Đổi tên/xoá file chết |
| Low | Docs | `docs/FE_HANDOFF_SPRINT6.md` còn mô tả EXCHANGE và `/resolve` | `BE docs/FE_HANDOFF_SPRINT6.md:9,77` | Đánh dấu lỗi thời hoặc cập nhật |

## 2. Kết luận audit

- **Critical**: 1 (BUG-002) — chưa xử lý, chặn release luồng SePay.
- **High**: 2 (BUG-001, execution gap) — chưa xử lý; BUG-001 cần quyết định phạm vi.
- **Medium**: 10 — phần lớn là consistency/security/config, có thể xử lý song song.
- **Low**: 11 — dọn dẹp, không chặn.
- Không có broken reference trong ma trận; không có ID trùng.
- Không có BR/AC/TC mồ côi sau khi bổ sung TC-044…TC-050 trong audit này.
- **Chấp nhận mở (Accepted)**: Critical/High nêu trên không được sửa trong bộ tài liệu vì
  workflow là read-only trên source. Việc chấp nhận chỉ có nghĩa “đã ghi nhận, chưa đóng”;
  release vẫn phải chặn theo `07-report.md` cho tới khi BUG-002/BUG-001 được xử lý.

## 3. Remediation đã thực hiện trong bộ tài liệu

| # | Việc | Kết quả |
|---|---|---|
| 1 | Bổ sung TC cho BR-002, BR-008, BR-010 và AC-009, AC-014, AC-016, AC-027, AC-030, AC-036 | TC-044…TC-050; 43/43 BR và 36/36 AC có test |
| 2 | Hạ các AC chưa có execution khỏi trạng thái `Verified` | 6 AC `Verified`, 30 `Unverified`; khớp `05-execution.md` |
| 3 | Đối chiếu lại endpoint/method FE ↔ controller | Sửa API-013 thành PATCH; loại bỏ nghi vấn sai |
| 4 | Ghi rõ giới hạn bằng chứng (unit-only, working tree dirty) | `05-execution.md` môi trường |

## 4. Vòng lặp audit

- Ma trận được dựng lại sau remediation; không còn lỗ hổng forward.
- Các finding Critical/High được giữ mở có chủ đích: sửa code nằm ngoài phạm vi
  “read-only on source” của workflow này; chủ sở hữu phải quyết định release.
- Lần audit kế tiếp: khi BUG-002 được sửa, thêm `EXEC` mới cho TC-015/TC-016 và chạy lại
  `07-report.md`; không sửa `EXEC` cũ.
