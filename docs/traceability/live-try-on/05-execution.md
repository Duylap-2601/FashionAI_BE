# Execution records — FLW-003 (live try-on)

- **Ngày:** 2026-11-18
- **Môi trường:** Windows, Jest unit BE (mocked Prisma/Decart), node:test + React SSR FE; không chạy browser/WebRTC/provider thật.
- **Lệnh BE:** `npx jest --config test/jest-unit.json --runInBand --verbose live-try-on live-combo`
  - Kết quả: 2 suite PASS, 16 test PASS (11 service + 5 combo), 0 FAIL. Log `D:/EXE/.tmp/live-tryon-jest.log`.
- **Lệnh FE:** `node --test tests/live-workspace.test.cjs tests/live-outfit-reference.test.cjs`
  - Kết quả: 7 test PASS, 0 FAIL. Log `D:/EXE/.tmp/live-tryon-fe.log`.
- **Tester:** automated.

## Bảng EXEC

| EXEC | TC | Ngày | Build | Status | Thực tế | Bằng chứng |
|---|---|---|---|---|---|---|
| EXEC-039 | TC-093 | 2026-11-18 | HEAD BE/FE | PASS | quota disabled trả limit 0, unit seconds | `test/unit/live-try-on.service.spec.ts` |
| EXEC-040 | TC-094 | 2026-11-18 | HEAD | PASS | FREE policy bật → enabled, limit 120 | `live-try-on.service.spec.ts` |
| EXEC-041 | TC-098 | 2026-11-18 | HEAD | PASS | ảnh theo màu BLACK, color chuẩn hoá | `live-try-on.service.spec.ts` |
| EXEC-042 | TC-099 | 2026-11-18 | HEAD | PASS | màu không thuộc sản phẩm → 400, không fetch | `live-try-on.service.spec.ts` |
| EXEC-043 | TC-102 | 2026-11-18 | HEAD | PASS | OUTER được chọn primary | `test/unit/live-combo.util.spec.ts` |
| EXEC-044 | TC-103 | 2026-11-18 | HEAD | PASS | không OUTER → FULL_BODY rồi INNER | `live-combo.util.spec.ts` |
| EXEC-045 | TC-104 | 2026-11-18 | HEAD | PASS | một món → index 0 | `live-combo.util.spec.ts` |
| EXEC-046 | TC-105 | 2026-11-18 | HEAD | PASS | prompt đúng thứ tự lớp, một action | `live-combo.util.spec.ts` |
| EXEC-047 | TC-106 | 2026-11-18 | HEAD | PASS | prompt ≤700 ký tự | `live-combo.util.spec.ts` |
| EXEC-048 | TC-107 | 2026-11-18 | HEAD | PASS | 2 budget update, lease upsert, token maxDuration | `live-try-on.service.spec.ts` |
| EXEC-049 | TC-108 | 2026-11-18 | HEAD | PASS | reused key mismatch → 409, không token | `live-try-on.service.spec.ts` |
| EXEC-050 | TC-111 | 2026-11-18 | HEAD | PASS | hết slot → 403, không gọi provider | `live-try-on.service.spec.ts` |
| EXEC-051 | TC-112 | 2026-11-18 | HEAD | PASS | mint lỗi → budget/lease release | `live-try-on.service.spec.ts` |
| EXEC-052 | TC-113 | 2026-11-18 | HEAD | PASS | resume đổi món, không reserve thêm | `live-try-on.service.spec.ts` |
| EXEC-053 | TC-114 | 2026-11-18 | HEAD | PASS | resume món ARCHIVED → lỗi, không token | `live-try-on.service.spec.ts` |
| EXEC-054 | TC-119 | 2026-11-18 | HEAD | PASS | paused 42s, daily 0 vẫn resume được | `tests/live-workspace.test.cjs` |
| EXEC-055 | TC-120 | 2026-11-18 | HEAD | PASS | live 8s: cảnh báo, khóa chọn, pause bật | `live-workspace.test.cjs` |
| EXEC-056 | TC-121 | 2026-11-18 | HEAD | PASS | PAUSED từ server 23s: resume/end bật | `live-workspace.test.cjs` |
| EXEC-057 | TC-122 | 2026-11-18 | HEAD | PASS | pausing khóa nút, hiện “Đang tạm dừng” | `live-workspace.test.cjs` |
| EXEC-058 | TC-126 | 2026-11-18 | HEAD | PASS | worker settle RESERVED hết hạn → EXPIRED/ISSUE_UNKNOWN | `live-try-on.service.spec.ts` |
| EXEC-059 | TC-127 | 2026-11-18 | HEAD | PASS | ảnh ghép chứa cả 2, bitmap close | `tests/live-outfit-reference.test.cjs` |
| EXEC-060 | TC-128 | 2026-11-18 | HEAD | PASS | cặp sai bị chặn trước fetch | `live-outfit-reference.test.cjs` |
| EXEC-061 | TC-129 | 2026-11-18 | HEAD | PASS | tải ảnh lỗi → reject, không blob dở | `live-outfit-reference.test.cjs` |

## Không chạy

TC-095…TC-097, TC-100, TC-101, TC-109, TC-110, TC-115…TC-118, TC-123…TC-125, TC-130 — không có test tương ứng trong hai lần chạy trên.

## Ghi chú

- 23 EXEC đến từ đúng 23 test (16 BE + 7 FE); không có test nào bị tính hai lần.
- BE test dùng mock Prisma/Decart nên chỉ chứng minh hợp đồng nội bộ, không chứng minh provider/WebRTC.
- FE test render tĩnh với hook mock; không chạy camera thật.
