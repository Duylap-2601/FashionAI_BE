# Traceability — Live Try-On (web FE + BE)

Workflow **FLW-003**: phiên thử đồ realtime Decart, quota giây, pause/resume/end, admin policy. Nguồn: `FashionAI_BE` + `FashionAI_FE`, 2026-11-18.

## Đọc theo thứ tự

| File | Nội dung |
|---|---|
| `00-workflow.md` | Scope, actor, sơ đồ, 12 bước, 15 alternate path |
| `01-user-stories.md` | 8 US (US-019…US-026), 24 AC (AC-061…AC-084) |
| `02-business-rules.md` | 36 BR (BR-082…BR-117) |
| `03-screens-and-flows.md` | 2 SCR, 8 CMP, 10 API |
| `04-test-cases.md` | 8 TS, 38 TC (TC-093…TC-130) |
| `05-execution.md` | 23 EXEC thật (16 BE + 7 FE) |
| `06-defects.md` | 9 defect candidate (6 Medium, 3 Low) |
| `07-report.md` | Pass 100% (23/23), execution 60,5% (23/38) |
| `08-traceability-matrix.md` | 36 dòng BR + kiểm tra hai chiều |
| `09-audit.md` | 2 High, 5 Medium, 5 Low finding; 6 OQ |

## Bằng chứng

```bash
cd D:/EXE/FashionAI_BE
npx jest --config test/jest-unit.json --runInBand --verbose live-try-on live-combo
# 2 suites / 16 tests

cd D:/EXE/FashionAI_FE
node --test tests/live-workspace.test.cjs tests/live-outfit-reference.test.cjs
# 7 tests
```

Không chạy WebRTC, camera, Decart thật hay browser; xem `05-execution.md`.

## Kết luận

- 36/36 BR và 24/24 AC có test; 23/38 TC đã chạy.
- Không có Critical/High defect; 6 Medium tập trung ở pause/terminal/admin/allowlist.
- Release: **Insufficient Evidence** toàn workflow; production **Not Ready** tới khi có staging/provider thật.
