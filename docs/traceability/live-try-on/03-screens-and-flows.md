# Screens, components, APIs — FLW-003

## SCR-026 — Web Live Try-On workspace

- **Route / Module / Purpose:** `/try-on` (tab “Live Try-On”) · `src/features/try-on/components/live-try-on-workspace.tsx`, `try-on-page.tsx`, hook `use-live-try-on.ts` · xem camera + kết quả Decart, quota, pause/resume/end.
- **Roles:** Customer đủ điều kiện.
- **Entry conditions:** Route công khai nhưng hook/API cần JWT; tab tự chuyển về “Thử bằng ảnh” nếu không có camera hoặc quota tắt/không eligible.
- **Related:** US-019…US-023, US-025, US-026 / AC-061…AC-083 / BR-082…BR-112

| CMP | Component | Purpose | Rules |
|---|---|---|---|
| CMP-053 | `GarmentSlot` / `TryOnSegmented` | Chọn 1 món hoặc phối bộ; khóa khi live/busy | BR-084, BR-087, BR-090 |
| CMP-054 | `GarmentColorPicker` | Chọn màu của từng lớp | BR-086 |
| CMP-055 | Video stage + `requestVideoFrameCallback` | Camera local, remote video, first-frame guard | BR-101 (token), UI rule |
| CMP-056 | Timer/quota panel | `remainingSeconds`, low-time, quota ngày | BR-083, BR-095 |
| CMP-057 | Action bar | Bắt đầu / Tạm dừng / Tiếp tục / Kết thúc | BR-104, BR-106, BR-109 |
| CMP-058 | Auto-capture controls | Chụp/tự chụp ảnh từ remote stream | Không có BR server; UI-only |

| API | Method | Endpoint | Purpose |
|---|---|---|---|
| API-056 | GET | `/try-on/live/quota` | Policy/quota/active session |
| API-057 | GET | `/try-on/live/garments/:productId` | Ảnh + prompt cho một món |
| API-058 | POST | `/try-on/live/garments/preview` | Preview combo, không tiêu quota |
| API-059 | POST | `/try-on/live/sessions` | Tạo phiên + token một lần |
| API-060 | GET | `/try-on/live/sessions/:id` | Trạng thái server-authoritative |
| API-061 | POST | `/try-on/live/sessions/:id/pause` | Tạm dừng |
| API-062 | POST | `/try-on/live/sessions/:id/resume` | Tiếp tục (+ đổi món) |
| API-063 | POST | `/try-on/live/sessions/:id/end` | Kết thúc |

**States:** idle; requesting-camera; connecting; preparing-garment; awaiting-first-frame; live; pausing; paused; stopping; ended; error. Empty: chưa chọn món; blocked: quota/lease thiết bị khác; permission denied: lỗi camera.
**Interactions:** chọn món/màu → start/resume; tắt tab/pagehide → pause keepalive; chuyển sang thử ảnh bị chặn khi còn session; logout → end.

## SCR-027 — Admin Live Try-On settings

- **Route / Module / Purpose:** Admin dashboard tab `live-try-on-settings` · `src/features/admin/components/admin-live-try-on-settings-panel.tsx` · xem/sửa policy theo tier.
- **Roles:** ADMIN.
- **Entry conditions:** Đăng nhập admin; route admin hiện tab.
- **Related:** US-024 / AC-078, AC-084 / BR-113…BR-117

| CMP | Component | Purpose | Rules |
|---|---|---|---|
| CMP-058 | Root settings form | enabled, global seconds, concurrency, pause timeout, categories | BR-113, BR-114 |
| CMP-059 | Tier table | FREE/MEMBER/VIP: liveEnabled, dailySeconds, maxSessionSeconds | BR-082, BR-114 |
| CMP-060 | Save/reason + version | Lưu policy kèm lý do | BR-115, BR-117 |

| API | Method | Endpoint | Purpose |
|---|---|---|---|
| API-064 | GET | `/admin/settings/live-try-on` | Đọc policy |
| API-065 | PUT | `/admin/settings/live-try-on` | Cập nhật policy + audit |

**States:** loading, load error toast, save pending, success toast, validation error (category rỗng; maxSession > daily).
**Interactions:** toggle category, sửa số, lưu; reload sau lỗi; không có màn audit history riêng (dữ liệu chỉ trong bảng audit).

## Backend-only surfaces

| Thành phần | Vai trò | Neo |
|---|---|---|
| `reconcileExpiredSessions` cron | Settle phiên RESERVED quá hạn mỗi phút, batch 50 | `live-try-on.service.ts:476-510` |
| Serializable reserve/settle | Chống double-spend quota/lease | `live-try-on.service.ts:512-676` |
| `LiveTryOnLease` unique userId | Một phiên/user | `schema.prisma:737-750` |
| `live_try_on_policy_audits` | Lịch sử trước/sau | `schema.prisma:752-764` |

## Liên kết ngược

- Mọi SCR/CMP đều thuộc US-019…US-026.
- `API-060` (status) không được FE poll định kỳ sau reload; chỉ gọi khi cần khôi phục. Đây là lý do OQ-014.
- Không có màn lịch sử phiên live trong web; `Auto-capture` chỉ nằm trong bộ nhớ phiên.
