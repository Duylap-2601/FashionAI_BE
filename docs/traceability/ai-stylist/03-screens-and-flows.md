# Screens, components, APIs — FLW-004 (AI Stylist)

## SCR-028 — `/ai-stylist`

- **Route / Module / Purpose:** `FE/src/app/(main)/ai-stylist/page.tsx` → `features/stylist/components/ai-stylist-page.tsx`; nhập brief, chạy tư vấn, xem kết quả, mở lịch sử, khôi phục deep link.
- **Roles:** mọi user đã đăng nhập (FREE/MEMBER/VIP); middleware chặn khách.
- **Entry conditions:** JWT cookie; có thể vào với `?result=<id>`.
- **Related US / BR:** US-027…US-032, US-034 / BR-118…BR-142, BR-148…BR-153, BR-155.

| CMP | Component | Purpose | Rules |
|---|---|---|---|
| CMP-059 | `stylist-input-panel.tsx` | Brief: occasion, style, budget, gender, ảnh + consent, chọn sản phẩm | BR-123, BR-124, BR-126, BR-149, BR-150 |
| CMP-060 | `ProductPickerModal.tsx` | Tìm/chọn sản phẩm catalog làm neo | BR-128, BR-131 |
| CMP-061 | `ai-stylist-page.tsx` | Orchestrator: state, submit, quota, history sheet, deep link | BR-120, BR-152, BR-153 |
| CMP-062 | `stylist-result-panel.tsx` | Verdict, màu, fit advice, warnings, outfits | BR-136, BR-148 |
| CMP-063 | `outfit-suggestion-list.tsx`, `outfit-suggestion-card.tsx`, `outfit-showcase-card.tsx` | Hiển thị outfit + item + tổng giá | BR-133, BR-134, BR-145 |
| CMP-064 | `suggested-product-list.tsx`, `suggested-product-card.tsx` | Sản phẩm gợi ý + quick add | BR-155 |
| CMP-065 | `stylist-history-panel.tsx` | Sheet lịch sử 5 mục/trang | BR-143, BR-144, BR-154 |
| CMP-067 | `QuotaExhaustedModal.tsx` | Hết lượt + CTA nâng cấp | BR-152 |
| CMP-068 | `stylist-brief-summary.tsx` | Tóm tắt brief đã gửi | BR-148 |
| CMP-069 | `product-cutout-image.tsx` | Ảnh sản phẩm với fallback | BR-145 |
| CMP-070 | `outfit-try-on-button.tsx` | Link thử đồ từ outfit | BR-155 |

| API | Method | Endpoint | Purpose |
|---|---|---|---|
| API-066 | POST | `/api/stylist/analyze` | Tạo kết quả (multipart) |
| API-067 | GET | `/api/stylist/history?page&limit` | Danh sách lịch sử |
| API-068 | GET | `/api/stylist/history/:id` | Chi tiết / deep link |
| API-069 | DELETE | `/api/stylist/history/:id` | Xoá kết quả |
| API-070 | GET | `/api/users/me/quota?action=STYLIST` | Badge quota |
| API-071 | GET | `/api/products?...` | Catalog cho picker (public) |

**States**

| State | Trigger | UI |
|---|---|---|
| initial | Mount, chưa gửi | Form trống + quota/history đang tải |
| loading | Đang tải quota/history | Skeleton/badge "Đang tải lượt" |
| processing | Đã submit, chờ API | `pageState='processing'`; form khoá; có thể >90 s → timeout |
| success | 200 | Result panel + toast; URL `?result=<id>` |
| empty | 200 nhưng `outfits=[]` | Empty state "chưa có bộ phối"; vẫn hiện verdict/màu |
| error 400 | Input/file sai | Toast chung + alert từ BE (chỉ khi idle) |
| error 429 | Hết quota | `QuotaExhaustedModal`; reset copy mặc định |
| error 5xx/503 | Provider/API key | Toast chung, không phân biệt nguyên nhân (BUG-046) |
| permission denied | Không JWT | Middleware redirect login |
| restore | `?result=<id>` | `useStylistResult`; 404 → panel lỗi restore |

**Interactions / navigation**

- Submit → `analyzeAsync` → `trackEvent('stylist_analyze')` → `refetchQuota`.
- Chọn item lịch sử → result + `syncResultUrl(item.id)` + đóng sheet.
- Xoá item → `deleteAsync`; nếu đang chọn thì về idle và bỏ `?result`.
- Outfit card → `/try-on?productId=<id>` hoặc `/try-on?rackIds=<top>,<bottom>`.
- Suggested product → quick add cart (variant màu/size).
- Nút "Hỏi AI Stylist" ở product detail hiện trỏ `/chat` (BUG-049), không phải màn này.

## SCR-029 — `/profile/stylist-history`

- **Route / Module / Purpose:** `FE/src/app/(main)/profile/stylist-history/page.tsx` → `profile-stylist-history-page.tsx`; lịch sử đầy đủ, phân trang, mở/xoá.
- **Roles:** user đã đăng nhập.
- **Entry conditions:** từ profile hoặc link trực tiếp.
- **Related US / BR:** US-033 / BR-142…BR-147, BR-154.

| CMP | Component | Purpose | Rules |
|---|---|---|---|
| CMP-066 | `profile-stylist-history-page.tsx` | List + phân trang + xoá + mở kết quả | BR-143, BR-144, BR-146, BR-147 |
| CMP-069 | `product-cutout-image.tsx` | Ảnh item | BR-145 |

| API | Method | Endpoint | Purpose |
|---|---|---|---|
| API-067 | GET | `/api/stylist/history?page&limit` | Danh sách |
| API-068 | GET | `/api/stylist/history/:id` | Mở chi tiết (nếu cần) |
| API-069 | DELETE | `/api/stylist/history/:id` | Xoá |

**States:** loading skeleton; empty "chưa có lịch sử"; error có retry (trang này xử lý `isError`, khác panel ở SCR-028); deleting item; 404 khi mở link cũ.

**Interactions:** đổi trang → query mới; xoá → invalidate list; item click → `/ai-stylist?result=<id>`.

## Ghi chú truy vết

- Không có màn admin cho stylist; model/prompt đổi bằng env + deploy.
- `API-071` là catalog dùng chung, không thuộc module stylist nhưng là điều kiện của CMP-060.
- Panel lịch sử trong SCR-028 và trang SCR-029 dùng cùng API-067 nhưng khác page size (5 vs 12).
