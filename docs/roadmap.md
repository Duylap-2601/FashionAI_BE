# 🗺️ FashionAI — Roadmap & Kế hoạch Kỹ thuật

> Tài liệu tổng hợp các tính năng đã thảo luận và sẽ triển khai trong tương lai.
> Cập nhật lần cuối: 2026-06-09

---

## ✅ Đã hoàn tất

### [BE] Migration: Replicate → fal.ai + SAM2
- Thay toàn bộ `try-on.service.ts` từ Replicate IDM-VTON sang **fal.ai FASHN v1.6**
- Tích hợp **SAM2** (`fal-ai/sam2/auto-segment`) làm bước preprocessing — tách background garment trước khi đưa vào FASHN
- Pipeline: `fal.storage.upload` → SAM2 → FASHN v1.6 (`balanced` mode) → Stream result
- Thêm `FAL_KEY` và `SAM2_ENABLED` vào `.env`
- Install `@fal-ai/client`
- **Controller, DTO, Module không thay đổi** — interface public giữ nguyên

---

## 🔜 Sẽ làm — Theo thứ tự ưu tiên

---

### 🔴 Ưu tiên cao — Bảo mật & Kiểm soát chi phí

#### [BE] Rate Limiting & Quota hệ thống Try-On
**Mục tiêu**: Tránh người dùng lạm dụng, kiểm soát chi phí fal.ai credit.

**Cơ chế theo tier:**
| Tier | Điều kiện | Lượt Try-On/ngày |
|---|---|---|
| Guest | Chưa đăng nhập | ❌ 0 (phải login) |
| Free | Đăng ký, chưa mua | 3 lần/ngày |
| Member | Đã mua ≥ 1 đơn | 10 lần/ngày |
| VIP | Mua thường xuyên | Không giới hạn |

**Việc cần làm:**
- [ ] Thêm `JwtAuthGuard` vào `POST /try-on` — chặn guest
- [ ] Tạo `TryOnQuotaGuard` dùng Redis track `tryon:quota:{userId}:{date}`
- [ ] Reset quota mỗi 24h (Redis TTL)
- [ ] API trả về `429` kèm thông tin `{ used, limit, resetAt }` khi hết quota
- [ ] **Kết hợp với cache**: Thử lại cùng sản phẩm → trả về cache, **không tính vào quota**

**UX khi hết lượt:**
```
"Bạn đã dùng hết 3 lượt thử đồ hôm nay.
 Mua bất kỳ sản phẩm → nhận 10 lượt/ngày
 Hoặc quay lại vào ngày mai (còn X tiếng)"
```

---

#### [BE] Cache kết quả Try-On — 3 lớp

**Mục tiêu**: Tránh gọi fal.ai API khi cùng input → tiết kiệm ~80% credit.

**Layer 1 — FE Cache (React Query)**
- [ ] Dùng `queryClient.setQueryData(['tryon', garmentId, category], result)`
- [ ] Scope: Trong session hiện tại. Switch qua lại sản phẩm → không gọi API

**Layer 2 — BE Cache (Redis + File/S3)**
- [ ] Hash input: `MD5(humanBuffer) + MD5(garmentBuffer) + category` → cache key
- [ ] Lưu result buffer vào storage của mình (không dùng URL của fal.ai vì expire sau 1h)
- [ ] TTL: 7 ngày
- [ ] Kiểm tra cache trước khi gọi fal.ai trong `try-on.service.ts`

**Layer 3 — Try-On History trong DB**
- [ ] Tạo bảng `try_on_results (id, user_id, product_id, category, result_url, cache_key, created_at, expires_at)`
- [ ] Tính năng phụ: "Lịch sử thử đồ của bạn"

---

### 🟡 Ưu tiên trung bình — Tính năng cốt lõi

#### [BE + DB] Quản lý số đo người dùng (Measurements)

**Mục tiêu**: Người dùng chỉ nhập số đo 1 lần, tái sử dụng mãi mãi.

**Fields cần lưu:**
```typescript
measurements: {
  height: number,    // cm — chiều cao
  weight: number,    // kg — cân nặng
  chest: number,     // cm — vòng ngực
  waist: number,     // cm — vòng eo
  hip: number,       // cm — vòng hông
  shoulder: number,  // cm — chiều rộng vai (quan trọng cho suit!)
}
```

**API cần tạo:**
- [ ] `GET  /users/me/measurements` — lấy số đo hiện tại
- [ ] `PUT  /users/me/measurements` — cập nhật số đo
- [ ] `POST /try-on` — BE tự đọc measurements từ user session, FE không cần gửi lại

**UX flow:**
1. **Onboarding** (lần đầu đăng nhập): Nhập số đo — có thể bỏ qua
2. **Profile > Số đo cơ thể**: Form đầy đủ để chỉnh sửa
3. **Try-On page**: Hiển thị số đo đã lưu + link "Cập nhật số đo" → không nhập lại

---

#### [FE] 3D Mannequin Viewer từ số đo

**Mục tiêu**: Người dùng thấy mannequin 3D phản chiếu đúng tỉ lệ cơ thể, rồi thử đồ lên đó.

**Approach: 3D Viewer + 2D Try-On Combo**
```
Measurements → Three.js mannequin (morph targets) → render front-view
                                                            ↓
                                              canvas.toBlob() → gửi lên BE
                                                            ↓
                                              FASHN try-on → kết quả 2D
```

**Stack:**
- `Three.js` + `@react-three/fiber` + `@react-three/drei`
- GLB body model với morph targets (chiều cao, ngực, eo, hông, vai)
- `OrbitControls` cho phép xoay 360°

**Components cần tạo:**
- [ ] `MannequinViewer.tsx` — Three.js canvas chính
- [ ] `MorphSliders.tsx` — Slider điều chỉnh tỉ lệ (slider là input chính, mannequin phản chiếu theo)
- [ ] `MannequinControls.tsx` — Nút xoay / reset view
- [ ] `lib/three/mannequin.helper.ts` — hàm map measurements → morph targets
- [ ] `lib/three/canvas.helper.ts` — hàm render canvas → Blob để gửi lên BE

**Lưu số đo khi kéo slider:**
- Kéo slider → local state thay đổi (chưa lưu)
- Dừng kéo (debounce 800ms) → hiện toast "Lưu số đo này vào hồ sơ?"
- Nhấn "Lưu" → `PUT /users/me/measurements`
- Nhấn "Đặt lại" → rollback về số đo đã lưu trong DB

---

#### [FE] Cấu trúc dự án Next.js 14 (App Router)

**Xem chi tiết tại**: Folder structure đã thảo luận. Tóm tắt:

```
src/
├── app/
│   ├── (auth)/login | register
│   ├── (main)/
│   │   ├── try-on/
│   │   ├── products/
│   │   ├── stylist/
│   │   └── profile/measurements/
│   └── api/try-on/    ← proxy đến BE NestJS
├── components/
│   ├── ui/            ← Button, Input, Modal, Slider, Toast
│   ├── 3d/            ← MannequinViewer, MorphSliders
│   ├── try-on/        ← TryOnPanel, GarmentUploader, TryOnResult
│   └── profile/       ← MeasurementForm, MeasurementCard
├── lib/
│   ├── api/           ← axios clients gọi BE
│   ├── hooks/         ← useMeasurements, useTryOn, useMannequin, useUnsavedChanges
│   ├── stores/        ← Zustand: measurement.store, try-on.store
│   └── three/         ← Three.js utilities
└── types/
```

**Dependencies cần cài:**
```bash
npm install three @react-three/fiber @react-three/drei
npm install zustand
npm install axios
npm install react-hook-form zod
npm install next-auth
npm install @tanstack/react-query
```

---

### 🟢 Ưu tiên thấp — Nâng cao & Tùy chọn

#### [BE] Giới hạn chỉ thử sản phẩm trong catalog
- [ ] `POST /try-on` nhận `productId` thay vì `garmentImage` upload tự do
- [ ] BE tự lấy garment image từ catalog → không bị upload ảnh lạ
- [ ] Cache hiệu quả hơn vì garment image cố định

#### [BE] Bot Detection & IP Fingerprinting
- [ ] Rate limit theo IP (không chỉ theo user)
- [ ] Detect request < 5 giây liên tục → throttle
- [ ] Flag nhiều account cùng IP

#### [FE] Try-On History UI
- [ ] Trang "Lịch sử thử đồ" — xem lại kết quả đã thử
- [ ] Không tính quota khi xem lại kết quả cũ

---

## 📐 Kiến trúc tổng thể (tương lai)

```
[FE — Next.js]
  │
  ├── /api/try-on (proxy)
  │         │
  │         ▼
  │   [BE — NestJS]
  │         ├── JwtAuthGuard
  │         ├── TryOnQuotaGuard (Redis)
  │         ├── Cache check (Redis + DB)
  │         │      │ Cache HIT → trả về ngay
  │         │      │ Cache MISS ↓
  │         │   fal.storage.upload (×2 ảnh)
  │         │      ↓
  │         │   SAM2 auto-segment (garment)
  │         │      ↓
  │         │   FASHN v1.6 balanced/quality
  │         │      ↓
  │         │   Download result → lưu cache
  │         │      ↓
  │         └── StreamableFile → FE
  │
  ├── 3D Mannequin (Three.js)
  │     measurements → morph targets → canvas render → humanImage
  │
  └── Zustand stores
        measurement.store (saved + draft + isDirty)
        try-on.store (results cache + quota info)
```

---

## 💰 Chi phí ước tính fal.ai

| Mode | Chi phí/lần | $10 được |
|---|---|---|
| SAM2 only | ~$0.003 | ~3,333 lần |
| FASHN balanced | ~$0.065 | ~153 lần |
| FASHN quality | ~$0.09 | ~111 lần |
| **SAM2 + FASHN balanced** | ~$0.068 | **~147 lần** |
| **SAM2 + FASHN quality** | ~$0.093 | **~107 lần** |

> Với cache 80% → $10 thực tế dùng được ~500–700 lần thử đồ unique.
