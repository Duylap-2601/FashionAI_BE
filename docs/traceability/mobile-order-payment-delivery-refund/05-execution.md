# Execution records — FLW-002 (mobile)

- **Ngày chạy:** 2026-11-18
- **Môi trường:** Windows 10.0.26200, Node v22+, repo `D:/EXE/FashionAI_Mobile` tại commit `594f275` (working tree sạch tại thời điểm chạy).
- **Lệnh:** `npx jest --runInBand --verbose src/features/cart src/features/checkout src/features/orders src/features/payments src/features/shipping src/features/notifications/utils/order-notification-target.test.ts src/api/http.test.ts`
- **Kết quả tổng:** 13 suite PASS, 109 test PASS, 0 FAIL (`D:/EXE/.tmp/mobile-flow-jest.log`).
- **Giới hạn:** đây là unit/contract test với axios mock và SSR/static render; không chạy app thật, camera, cổng thanh toán, GHN hay push. `PASS` chỉ chứng minh hành vi ở lớp được test.
- **Tester:** automated (Jest), ghi nhận bởi assistant.

## Bảng EXEC

| EXEC | TC | Ngày | Build | Status | Thực tế | Bằng chứng |
|---|---|---|---|---|---|---|
| EXEC-018 | TC-051 | 2026-11-18 | 594f275 | PASS | 8 test cart API pass; đúng path/body/UUID guard | `src/features/cart/api/cart.api.test.ts` |
| EXEC-019 | TC-052 | 2026-11-18 | 594f275 | PASS | 7 test tách tạm tính/sale; không âm; tổng khớp | `src/features/checkout/utils/checkout-display.test.ts` |
| EXEC-020 | TC-057 | 2026-11-18 | 594f275 | PASS | 13 test orders API pass | `src/features/orders/api/orders.api.test.ts` |
| EXEC-021 | TC-059 | 2026-11-18 | 594f275 | PASS | 2 test checkout/status pass | `src/features/payments/api/payments.api.test.ts` |
| EXEC-022 | TC-061 | 2026-11-18 | 594f275 | PASS | 3 test unpaid orders: lọc CREATED+PENDING, limit 5 | `src/features/orders/api/orders.api.test.ts` |
| EXEC-023 | TC-064 | 2026-11-18 | 594f275 | PASS | 6 test nhãn/kết quả thanh toán | `src/features/payments/utils/payment-display.test.ts` |
| EXEC-024 | TC-068 | 2026-11-18 | 594f275 | PASS | test tab/search/paging pass | `src/features/orders/api/orders.api.test.ts` |
| EXEC-025 | TC-072 | 2026-11-18 | 594f275 | PASS | 5 test ưu tiên raw GHN | `src/features/orders/utils/order-shipping.test.ts` |
| EXEC-026 | TC-073 | 2026-11-18 | 594f275 | PASS | 4 test mã đơn/tổng/provider | `src/features/orders/utils/order-format.test.ts` |
| EXEC-027 | TC-074 | 2026-11-18 | 594f275 | PASS | 1 test POST confirm-delivery | `src/features/orders/api/orders.api.test.ts` |
| EXEC-028 | TC-075 | 2026-11-18 | 594f275 | PASS | Suite 28 test; nhóm cửa sổ 7 ngày/trạng thái pass | `src/features/orders/utils/order-returns.test.ts` |
| EXEC-029 | TC-076 | 2026-11-18 | 594f275 | PASS | 2 test giới hạn/thông báo ảnh | `src/features/orders/utils/evidence-images.test.ts` |
| EXEC-030 | TC-077 | 2026-11-18 | 594f275 | PASS | test chặn item theo issue pass | `src/features/orders/utils/order-returns.test.ts` |
| EXEC-031 | TC-078 | 2026-11-18 | 594f275 | PASS | 6 test validate form | `src/features/orders/utils/order-returns.test.ts` |
| EXEC-032 | TC-079 | 2026-11-18 | 594f275 | PASS | 5 test refund-not-received | `src/features/orders/utils/order-returns.test.ts` |
| EXEC-033 | TC-080 | 2026-11-18 | 594f275 | PASS | test evidence string/object/unknown pass | `src/features/orders/utils/order-returns.test.ts` |
| EXEC-034 | TC-081 | 2026-11-18 | 594f275 | PASS | test timeline COMPLETED/updatedAt pass | `src/features/orders/utils/order-returns.test.ts` |
| EXEC-035 | TC-082 | 2026-11-18 | 594f275 | PASS | 2 test my-returns paging/meta | `src/features/orders/api/orders.api.test.ts` |
| EXEC-036 | TC-083 | 2026-11-18 | 594f275 | PASS | 1 test multipart issue + bank fields | `src/features/orders/api/orders.api.test.ts` |
| EXEC-037 | TC-084 | 2026-11-18 | 594f275 | PASS | 1 test POST confirm refund | `src/features/orders/api/orders.api.test.ts` |
| EXEC-038 | TC-087 | 2026-11-18 | 594f275 | PASS | 6 test notification target | `src/features/notifications/utils/order-notification-target.test.ts` |

## Không chạy

`TC-053…TC-056`, `TC-058`, `TC-060`, `TC-062`, `TC-063`, `TC-065…TC-067`, `TC-069…TC-071`, `TC-085`, `TC-086`, `TC-088`, `TC-089` — chưa có test UI/E2E hoặc test cho nhánh lỗi; trạng thái thiết kế là `Not Run`, không được tính là pass.

## Ghi chú về độ phủ

- 109 test trải trên 13 suite; một số suite phục vụ nhiều TC (ví dụ `order-returns.test.ts` phục vụ TC-075, TC-077…TC-081). Không có test nào bị tính hai lần vào pass rate; mỗi `EXEC` là một lần đối chiếu hành vi với TC tương ứng.
- Không chạy `src/features/auth/api/auth.api.test.ts` trong lần này, nên TC-088 để `Not Run` dù test tồn tại.
- Không chạy full repo; một lần chạy rộng hơn của trợ lý ghi nhận 1 test cấu hình theme fail ngoài phạm vi flow, không dùng làm bằng chứng cho FLW-002.
