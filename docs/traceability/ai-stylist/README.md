# Traceability — AI Stylist (web FE + BE)

Workflow **FLW-004**: tư vấn outfit từ catalog bằng Gemini, quota theo tier, ảnh tuỳ chọn có consent, cache, lịch sử. Nguồn: `FashionAI_BE` + `FashionAI_FE`, 2026-11-18.

## Đọc theo thứ tự

| File | Nội dung |
|---|---|
| `00-workflow.md` | Scope, actor, sơ đồ, 16 bước, alternate paths |
| `01-user-stories.md` | 8 US (US-027…US-034), 24 AC (AC-085…AC-108) |
| `02-business-rules.md` | 38 BR (BR-118…BR-155) |
| `03-screens-and-flows.md` | 2 SCR, 12 CMP, 6 API |
| `04-test-cases.md` | 9 TS, 47 TC (TC-131…TC-177) |
| `05-execution.md` | 32 EXEC thật (BE Jest + FE node:test, mock provider) |
| `06-defects.md` | 16 defect candidate (2 High, 4 Medium, 10 Low) |
| `07-report.md` | Pass 100% (32/32), execution 68,1% (32/47) |
| `08-traceability-matrix.md` | 38 dòng BR + kiểm tra hai chiều |
| `09-audit.md` | 3 High, 4 Medium, 7 Low finding; 6 OQ |

## Bằng chứng

```bash
cd D:/EXE/FashionAI_BE
npx jest --config test/jest-unit.json --runInBand \
  test/unit/stylist.service.spec.ts \
  test/unit/stylist.controller.spec.ts \
  test/unit/product-suggestion.service.spec.ts \
  test/unit/quota.service.spec.ts \
  test/unit/quota.guard.spec.ts
npx jest --config test/jest-e2e.json test/e2e/stylist-analyze.e2e-spec.ts

cd D:/EXE/FashionAI_FE
node --test tests/outfit-suggestions.test.cjs tests/error-handling.test.cjs
```

Prisma/Gemini đều mock; không chạy Postgres/Redis/Gemini/browser thật.

## Kết luận

- 38/38 BR và 24/24 AC có test thiết kế; 32/47 TC đã chạy.
- 2 High: quota race (BUG-042), cache bỏ qua số đo (BUG-055).
- Release: **Not Ready** tới khi 2 High đóng và nhóm test `Not Run` chạy trên staging.
