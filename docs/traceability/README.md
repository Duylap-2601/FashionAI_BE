# Traceability docs — FashionAI

Bộ tài liệu truy vết theo `traceability-workflow`; mỗi workflow một thư mục, ID không tái sử dụng giữa các workflow.

| Workflow | Phạm vi | Thư mục |
|---|---|---|
| FLW-001 | Web/BE: đặt hàng → thanh toán → giao hàng → đổi trả/hoàn tiền | `checkout-to-delivery/` |
| FLW-002 | Mobile: đặt hàng → thanh toán → giao hàng → đổi trả/hoàn tiền | `mobile-order-payment-delivery-refund/` |
| FLW-003 | Live try-on: phiên Decart, quota giây, pause/resume/end, admin policy | `live-try-on/` |
| FLW-004 | AI Stylist: tư vấn outfit từ catalog, quota, ảnh + consent, cache, lịch sử | `ai-stylist/` |

Mỗi thư mục có `README.md` mô tả thứ tự đọc, phạm vi bằng chứng và kết luận release.

## Quy ước chung

- `Documented` / `Code-verified` / `Inferred` / `Unknown` trên từng entity.
- `PASS`/`FAIL` chỉ khi có `EXEC` thật; `Not Run` không được tính coverage.
- Báo cáo luôn nêu mẫu số; execution history chỉ thêm, không sửa.
- Tài liệu đặt trong `FashionAI_BE/docs/traceability/` dù bao phủ cả FE/mobile.

## Kiểm tra nhanh

```bash
cd D:/EXE/FashionAI_BE
npx jest --config test/jest-unit.json --runInBand
npx jest --config test/jest-e2e.json --runInBand
```

Không chạy provider/DB thật trong các lần đo hiện tại; xem giới hạn trong từng `05-execution.md`.
