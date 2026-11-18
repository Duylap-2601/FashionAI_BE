# Traceability — Gói thành viên (subscription)

Workflow **FLW-005**: mua / gia hạn / nâng cấp / hẹn hạ gói, thanh toán ZaloPay–SePay, nhắc gia hạn và thu hồi quyền lợi khi hoàn tiền. Nguồn: `FashionAI_BE` + `FashionAI_FE`, 2026-11-18.

## Đọc theo thứ tự

| File | Nội dung |
|---|---|
| `00-workflow.md` | Scope, actor, sơ đồ, 16 bước, 13 alternate path |
| `01-user-stories.md` | 8 US (US-035…US-042), 24 AC (AC-109…AC-132) |
| `02-business-rules.md` | 38 BR (BR-156…BR-193) |
| `03-screens-and-flows.md` | 2 SCR, 12 CMP, 11 dòng API (gộp API-075/074) |
| `04-test-cases.md` | 6 TS, 44 TC (TC-178…TC-221) |
| `05-execution.md` | 44 EXEC (BE Jest + FE node:test, mock gateway) |
| `06-defects.md` | 6 defect candidate (0 High, 3 Medium, 3 Low) |
| `07-report.md` | Pass 100% (43/43), execution 100% (44/44, 1 BLOCKED) |
| `08-traceability-matrix.md` | 38 dòng BR + kiểm tra hai chiều |
| `09-audit.md` | 7 finding (1 High tài liệu, 3 Medium, 3 Low); 6 OQ |

## Bằng chứng

```bash
cd D:/EXE/FashionAI_BE
npx jest --config test/jest-unit.json --runInBand \
  test/unit/subscription-lifecycle.spec.ts \
  test/unit/subscription-proration.spec.ts \
  test/unit/subscription-refund-revocation.spec.ts \
  test/unit/renewal-reminder-lock.spec.ts \
  test/unit/subscription-history.spec.ts
npx jest --config test/jest-e2e.json \
  test/e2e/payments-checkout.e2e-spec.ts \
  test/e2e/payments-webhook.e2e-spec.ts \
  test/e2e/subscription-endpoints.e2e-spec.ts

cd D:/EXE/FashionAI_FE
node --test tests/payment-display.test.cjs
```

Prisma/Redis/ZaloPay/SePay đều mock; không chạy Postgres/Redis/cổng thanh toán/browser thật.

## Kết luận

- 38/38 BR và 24/24 AC có test thiết kế; 44/44 TC có EXEC (43 PASS, 1 BLOCKED).
- Không có Critical/High về hành vi; 3 Medium (BUG-058 race SCHEDULED, BUG-060 giá fallback, BUG-062 thiếu test return page).
- Release: **Ready with Known Issues** cho phạm vi gói thành viên tới khi chạy smoke test cổng sandbox + Postgres thật.
