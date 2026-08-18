# 🧍 Kế Hoạch Chi Tiết — Phase 4: 3D Mannequin

> Ngày: 2026-08-18 | Dựa trên SRS FR-08 + Swagger BE thực tế

---

## 📋 Tổng Quan Hiện Trạng

### ✅ FE đã có
| File | Nội dung |
|---|---|
| `components/mannequin/MannequinViewer.tsx` | Three.js viewer dùng geometry primitives, có canvas capture |
| `@react-three/fiber` + `@react-three/drei` | Đã cài trong `package.json` |
| `hooks/useMeasurements.ts` | Lấy số đo từ BE (`GET /users/me/measurements`) |

### ✅ BE đã có (đã implement xong Phase 4 BE)
| File | Nội dung |
|---|---|
| `POST /api/avatar/generate` | Blender + MPFB2 pipeline, sync ~2s, trả `{ id, glbUrl, isCached, measuredCm, timingS }` |
| `GET /api/avatar/me` / `GET /api/avatar/:id` | Lấy avatar mới nhất / chi tiết theo ID |
| `GET /api/avatar/:name/file` | Stream file GLB lưu local (fallback khi không có Cloudinary) |
| `prisma` model `Avatar` | `@@unique([userId, cacheKey])` — cache theo hash số đo |
| `src/modules/avatar/blender/generate_avatar.py` | Script Blender headless + `calibration.json` (đường cong chiều cao, đo chu vi) |
| E2E | `test/e2e/avatar.e2e-spec.ts` (5 test) + E2E thật với Blender/Cloudinary |

### ❌ Còn thiếu (thuộc scope FE)
- FE chưa có `hooks/useAvatar.ts`, chưa load GLB vào `MannequinViewer` (xem Giai Đoạn 3 bên dưới)

### ⚠️ Nhận định quan trọng
> **BE Blender pipeline đã sẵn sàng** (sync ~2s, không cần async/job queue như kế hoạch cũ giả định 30–60s).
> **Giải pháp ngay bây giờ:** Triển khai theo 2 luồng song song — Luồng A (FE-only, làm được ngay) và Luồng B (FE hook GLB, BE đã xong).

---

## 🗺️ Lộ Trình 4 Giai Đoạn

```
Luồng A (FE-only)          Luồng B (cần BE)
─────────────────          ────────────────
Giai đoạn 1 ──────────►   Giai đoạn 3 (chờ BE)
Giai đoạn 2                Giai đoạn 4 (optional)
```

---

## 🎯 Giai Đoạn 1 — Preset Mannequin + Canvas Capture
> **Thời gian:** 2–3 ngày | **Phụ thuộc BE:** ❌ Không cần | **Làm được ngay:** ✅

### Mục tiêu
Cho phép **tất cả user** (kể cả Free/Guest) thử đồ trên mannequin 3D theo preset kích cỡ S/M/L/XL/XXL — **không tốn API fal.ai** vì cache 100% theo SRS Cost Strategy.

### Kiến trúc

```
User chọn size (S/M/L/XL)
        ↓
MannequinViewer (Three.js) render theo preset measurements
        ↓
Canvas.toDataURL() → Blob → humanImage
        ↓
POST /try-on { humanImage, productId } → fal.ai FASHN
        ↓
Kết quả Try-On
```

### Files cần làm

#### [MODIFY] `components/mannequin/MannequinViewer.tsx`
- Thêm preset `SIZE_PRESETS` với số đo chuẩn S/M/L/XL/XXL (male/female)
- Thêm nút "Chụp & Thử ngay" trigger `canvas.toDataURL()` → callback
- Thêm `ref` để expose capture function ra ngoài
- Cải thiện 3D model với smooth geometry (hiện đang dùng primitive shapes)

#### [NEW] `components/mannequin/SizePresetSelector.tsx`
- UI chọn gender + size preset (S/M/L/XL/XXL)
- Hiển thị các measurement tương ứng
- Có slider tùy chỉnh nhỏ cho height

#### [NEW] `hooks/useMannequin.ts`
```typescript
// Hook quản lý state mannequin + capture + submit try-on
export function useMannequinTryOn() {
  const [measurements, setMeasurements] = useState(SIZE_PRESETS['female']['M']);
  const captureRef = useRef<() => string>();
  
  const captureAndTryOn = async (productId: string) => {
    const dataUrl = captureRef.current?.();
    if (!dataUrl) return;
    const blob = dataUrlToBlob(dataUrl);
    const humanImage = new File([blob], 'mannequin.png', { type: 'image/png' });
    // gọi POST /try-on
  };
  
  return { measurements, setMeasurements, captureRef, captureAndTryOn };
}
```

#### [MODIFY] `app/(main)/try-on/page.tsx`
- Thêm tab "🧍 Mannequin" bên cạnh "📷 Upload ảnh"
- Tích hợp `SizePresetSelector` + `MannequinViewer`
- Nút "Thử ngay với Mannequin" → capture → submit

### Size Preset Table (sẽ hard-code)
```typescript
const SIZE_PRESETS = {
  female: {
    'XS': { height: 155, weight: 45, chest: 80, waist: 62, hip: 85, shoulder: 36 },
    'S':  { height: 158, weight: 50, chest: 84, waist: 66, hip: 89, shoulder: 37 },
    'M':  { height: 162, weight: 56, chest: 88, waist: 70, hip: 94, shoulder: 39 },
    'L':  { height: 165, weight: 62, chest: 93, waist: 76, hip: 99, shoulder: 40 },
    'XL': { height: 168, weight: 70, chest: 98, waist: 82, hip: 104, shoulder: 42 },
  },
  male: {
    'S':  { height: 165, weight: 58, chest: 88, waist: 74, hip: 88, shoulder: 42 },
    'M':  { height: 172, weight: 68, chest: 94, waist: 80, hip: 94, shoulder: 44 },
    'L':  { height: 176, weight: 76, chest: 100, waist: 86, hip: 100, shoulder: 46 },
    'XL': { height: 180, weight: 85, chest: 106, waist: 92, hip: 106, shoulder: 48 },
    'XXL':{ height: 182, weight: 95, chest: 112, waist: 100, hip: 112, shoulder: 50 },
  }
};
```

---

## 🎯 Giai Đoạn 2 — Đồng Bộ Số Đo Người Dùng → Mannequin
> **Thời gian:** 1 ngày | **Phụ thuộc BE:** ❌ Không cần | **Làm được ngay:** ✅

### Mục tiêu
User đã nhập số đo ở `/profile/measurements` → Mannequin tự động load và hiển thị theo số đo thật.

### Files cần làm

#### [MODIFY] `app/(main)/try-on/page.tsx`
- Khi user đã đăng nhập & có measurements → auto-select "Số đo của tôi" thay vì preset
- Thêm section "📏 Dùng số đo của tôi" (Member+) vs "🧍 Chọn size" (Free/Guest)

#### [MODIFY] `components/mannequin/SizePresetSelector.tsx`
- Thêm option "Số đo của tôi" (chỉ hiện khi `measurements` có data)
- Khi chọn → load số đo từ `useMeasurements()` vào viewer

#### [MODIFY] `app/(main)/profile/measurements/page.tsx`
- Thêm preview mannequin nhỏ (`MiniMannequinPreview`) bên cạnh form nhập số đo
- Cập nhật realtime khi người dùng thay đổi giá trị

---

## 🎯 Giai Đoạn 3 — GLB Avatar từ BE (Blender Pipeline)
> **Thời gian:** 3–5 ngày | **Phụ thuộc BE:** ✅ **Đã xong (BE)** | **Hiện tại: FE chờ BE output**

### Điều kiện tiên quyết ✅ (đã hoàn thành bên BE)
- ✅ Endpoint `POST /api/avatar/generate` nhận `{ gender, height, weight, chest, waist, hip, shoulder, draco?, morph? }` → trả `{ id, glbUrl, isCached, measuredCm, timingS }`
- ✅ Blender + MPFB2 cài đặt và script `generate_avatar.py` (sync ~2s, không phải 30–60s)
- ✅ Cache theo hash số đo (cùng số đo → trả cache ngay, không chạy lại Blender)
- ✅ GLB upload Cloudinary (raw resource) nếu cấu hình; fallback lưu local `storage/avatars/` + `GET /api/avatar/:name/file`
- ✅ Bảng `avatars` (Prisma model, `@@unique([userId, cacheKey])`) + migration đã áp
- ✅ `GET /api/avatar/me` trả avatar mới nhất, `GET /api/avatar/:id` trả chi tiết
- ✅ E2E test `test/e2e/avatar.e2e-spec.ts` (mock Blender) — 5 test pass
- ✅ E2E thật: user register → `POST /api/avatar/generate` → 201, GLB 4.6MB (magic `glTF`) trên Cloudinary, lần 2 `AVATAR_CACHE_HIT`

> Lưu ý cho FE: đoạn loading "30–60s Blender render" trong UX Flow bên dưới nên đổi thành ~2s (sync request), không cần polling. `measuredCm` là kết quả đo lại sau khi sinh để FE hiển thị sai lệch nếu muốn.

### FE sẽ làm khi BE ready

#### [NEW] `hooks/useAvatar.ts`
```typescript
export function useGenerateAvatar() {
  return useMutation({
    mutationFn: async (measurements: UserMeasurements) => {
      const res = await api.post('/avatar/generate', measurements);
      return res.data as { glbUrl: string; avatarId: string };
    },
  });
}
```

#### [MODIFY] `components/mannequin/MannequinViewer.tsx`
- Thêm mode `mode: 'geometry' | 'glb'`
- Khi `glbUrl` có → dùng `useGLTF(glbUrl)` từ `@react-three/drei` để load model thật
- Fallback về geometry primitives khi không có GLB

#### UX Flow
```
User nhấn "Tạo Avatar từ số đo"
        ↓
Loading spinner (~2s Blender render, sync)
        ↓
GLB load vào Three.js viewer
        ↓
User có thể xoay, zoom
        ↓
"Thử ngay" → canvas capture → FASHN
```

---

## 🎯 Giai Đoạn 4 — Advanced: Morph Targets & Slider Sync
> **Thời gian:** 3–4 ngày | **Phụ thuộc BE:** ✅ Cần GLB có morph targets | **Optional**

### Mục tiêu
Real-time deformation: kéo slider chiều cao/ngực/eo → mannequin thay đổi ngay lập tức (như ZARA/H&M size guide).

### Yêu cầu kỹ thuật
- GLB phải có **morph targets** (blend shapes) đúng tên theo MPFB2 (`measure-bust-circ-decr-incr`, etc.)
- FE dùng `mesh.morphTargetInfluences[]` để control từng morph

### Files cần làm

#### [MODIFY] `components/mannequin/MannequinViewer.tsx`
```typescript
// Khi GLB có morph targets
useFrame(() => {
  if (meshRef.current?.morphTargetInfluences) {
    meshRef.current.morphTargetInfluences[bustIndex] = (chest - 80) / 60;
    meshRef.current.morphTargetInfluences[waistIndex] = (waist - 60) / 40;
    // ...
  }
});
```

#### [NEW] `components/mannequin/MorphSliders.tsx`
- Sliders cho từng measurement
- Sync 2 chiều với `/profile/measurements`
- Debounce 500ms trước khi gọi API update

---

## 📊 So Sánh Các Phương Án

| | Giai đoạn 1+2 | Giai đoạn 3 | Giai đoạn 4 |
|---|---|---|---|
| **BE cần** | ❌ Không | ✅ Blender API | ✅ GLB + Morphs |
| **Thời gian FE** | 3–4 ngày | 2 ngày | 3–4 ngày |
| **Chất lượng avatar** | ⭐⭐ Geometric | ⭐⭐⭐⭐ Realistic | ⭐⭐⭐⭐⭐ |
| **Chi phí vận hành** | $0 (preset cache) | Trung bình | Cao |
| **Phù hợp SRS** | ✅ Cost strategy | ✅ FR-08 | ✅ FR-08-6 |
| **MVP ready** | ✅ **Có thể làm ngay** | ⏳ Chờ BE | ⏳ Chờ BE |

---

## 🚧 Rủi Ro & Giảm Thiểu

| Rủi ro | Mức độ | Giảm thiểu |
|---|---|---|
| BE Blender chưa xong | Cao | Giai đoạn 1+2 hoạt động độc lập |
| Canvas capture trên mobile bị CORS | Trung bình | `preserveDrawingBuffer: true` (đã có) |
| GLB file quá lớn (>5MB) | Trung bình | Dùng `Draco` compression |
| Morph target tên không khớp MPFB2 | Cao | Cần BE confirm tên từng morph |
| `@react-three/fiber` SSR conflict | Thấp | Dùng `dynamic import` với `{ ssr: false }` |

---

## ✅ Đề Xuất Thực Hiện

> **Làm ngay (không chờ BE):** Giai đoạn 1 + 2
> **Làm khi BE sẵn sàng:** Giai đoạn 3 (2 ngày) → Giai đoạn 4 (optional)

### Thứ tự implementation Giai đoạn 1+2:

```
Ngày 1:
  □ Tạo SIZE_PRESETS constants
  □ Tạo hooks/useMannequin.ts
  □ Tạo SizePresetSelector.tsx

Ngày 2:
  □ Cải thiện MannequinViewer (geometry đẹp hơn, canvas capture hoàn chỉnh)
  □ Tích hợp tab "Mannequin" vào try-on page

Ngày 3:
  □ Sync số đo user → mannequin auto-load
  □ Mini mannequin preview trong measurements page
  □ Test end-to-end: chọn size → capture → FASHN → kết quả
```

---

## ❓ Câu Hỏi Cần Xác Nhận

> [!IMPORTANT]
> 1. **BE Blender pipeline** — Bao giờ BE sẵn sàng endpoint `/avatar/generate`?
> 2. **GLB Morph targets** — BE có export đúng tên morph từ MPFB2 không? Cần list tên cụ thể.
> 3. **Preset cache strategy** — Có muốn pre-generate try-on results cho 5 preset sizes × tất cả sản phẩm không? (SRS §4.5 — Cache 100% cho Free user)
> 4. **Priority** — Bắt đầu với Giai đoạn 1+2 ngay bây giờ?
