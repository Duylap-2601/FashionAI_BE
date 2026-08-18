# Phase 4 — FE Handover: GLB Avatar Presets + Morph Sliders

> **Mục tiêu:** Mọi user dùng được tính năng "Tạo Avatar từ số đo" mà **không cần cài Blender** ở bất kỳ đâu (server BE cũng không cần).
>
> **Chiến lược:** BE sinh sẵn **một lần offline** một lưới GLB preset `(gender × height × weight)` lên Cloudinary. FE chọn preset gần nhất theo số đo → load GLB → dùng **morph targets** (đã có sẵn trong GLB) để tinh chỉnh chest/waist/hip/shoulder cho khớp 100% số đo người dùng.

---

## 1. Kiến trúc

```
┌─────────────┐  GET /api/avatar/presets/nearest  ┌──────────────────────┐
│  FE (React) │ ────────────────────────────────► │  BE NestJS            │
│  Three.js   │ ◄────────────────────────────────  │  - Đọc bảng           │
└─────┬───────┘   { presetGlbUrl, morphDeltasCm,   │    avatar_presets     │
      │            morphFactors, presetMeasurements }                       │
      ▼                                            └──────────┬───────────┘
┌─────────────┐                                            (read-only,
└─────────────┘                                             không gọi Blender)
   useGLTF(glbUrl) → scene → áp morphTargetInfluences[]
      │
      ▼
Cloudinary: preset_female_165_55.glb (có morph targets)
```

- **BE production:** chỉ đọc bảng `avatar_presets` → trả JSON. Không chạy Blender, không tốn CPU.
- **Sinh preset (offline):** chạy trên máy dev có Blender + MPFB2, dùng lại `generate_avatar.py` + `calibration.json` hiện có. Kết quả upload Cloudinary + ghi bảng `avatar_presets`.

---

## 2. API Contract (BE sẽ cung cấp — FE chờ)

### 2.1 `GET /api/avatar/presets/nearest?gender=female&height=165&weight=56&chest=88&waist=70&hip=94&shoulder=39`

JWT bắt buộc (giống các endpoint avatar khác). ✅ **Đã implement** — nhận đủ 7 tham số số đo.

```json
{
  "success": true,
  "code": "AVATAR_PRESET_NEAREST",
  "data": {
    "gender": "female",
    "preset": {
      "id": "clx...",
      "height": 165,
      "weight": 55,
      "glbUrl": "https://res.cloudinary.com/.../preset_female_165_55.glb"
    },
    "presetMeasurements": {
      "chest": 84.9,
      "waist": 65.4,
      "hip": 102.5,
      "shoulder": 40.9
    },
    "morphDeltasCm": {
      "chest": 3.1,
      "waist": 4.6,
      "hip": -8.5,
      "shoulder": -1.9
    },
    "morphFactors": {
      "chest": 16.9,
      "waist": 8.5,
      "hip": 19.1,
      "shoulder": 5.0
    }
  }
}
```

- `morphDeltasCm[field] = userInput[field] - presetMeasurements[field]` (đơn vị cm, có dấu).
- `morphFactors[field]` = số cm thay đổi trên 1 đơn vị morph (đã calibrate, khác nhau giữa nam/nữ — **đừng hardcode phía FE**).
- Preset gần nhất = tìm điểm `(height, weight)` gần nhất trên lưới theo khoảng cách chuẩn hoá.

### 2.2 `GET /api/avatar/presets?gender=female`

Trả toàn bộ preset của một giới (cho UI hiện list chọn trước nếu muốn). Mỗi phần tử như `data.preset` ở trên.

---

## 3. Morph mapping (quan trọng cho FE)

> ✅ **Đã xác nhận thực tế:** GLB preset sinh với `force_morph_targets` chứa **đủ 8 morph** `measure-*` (cả incr lẫn decr) ở weight ≈ 0 (`weights` rỗng → Three.js khởi tạo mọi influence = 0). Base mesh = hình tỷ lệ mặc định (macro-only). FE áp đè influence trực tiếp từ số đo user.

| Field FE | Morph target incr | Morph target decr | Factor (nữ) | Factor (nam) |
|---|---|---|---|---|
| `chest` | `measure-bust-circ-incr` | `measure-bust-circ-decr` | 16.9 | 16.9 |
| `waist` | `measure-waist-circ-incr` | `measure-waist-circ-decr` | 8.5 | 9.9 |
| `hip`   | `measure-hips-circ-incr` | `measure-hips-circ-decr` | 19.1 | 19.0 |
| `shoulder` | `measure-shoulder-dist-incr` | `measure-shoulder-dist-decr` | 5.0 | 5.0 |

> ⚠️ `morphFactors` BE trả về **đã scale theo chiều cao preset** (`preset.height / ref_height`), vd nữ height 165 → chest ≈ 17.5. **Đừng dùng bảng trên cứng, hãy dùng `morphFactors` từ response.**

Công thức áp influence (đọc tên morph qua `mesh.morphTargetDictionary`, clamp ±1):

```
delta  = morphDeltasCm[field]               // = user − presetMeasurements
influence = clamp(delta / morphFactors[field], -1, 1)

if influence > 0 → morphTargetInfluences[incr] =  influence;  [decr] = 0
if influence < 0 → morphTargetInfluences[incr] =  0;          [decr] = |influence|
if influence == 0 → cả hai = 0
```

Ví dụ nữ, `delta = 3.1` cho chest, factor 17.5 → `influence = 0.177` → `measure-bust-circ-incr = 0.177`, `measure-bust-circ-decr = 0`.

---

## 4. FE Implementation Steps

### Step 1 — Hook lấy preset
`[NEW] hooks/useAvatarPreset.ts`
```typescript
export interface PresetNearest {
  preset: { glbUrl: string; height: number; weight: number };
  presetMeasurements: Record<MeasureField, number>;
  morphDeltasCm: Record<MeasureField, number>;
  morphFactors: Record<MeasureField, number>;
}

export function useAvatarPreset() {
  return useQuery({
    queryKey: ['avatar-preset', gender, height, weight],
    queryFn: async () => {
      const res = await api.get('/avatar/presets/nearest', {
        params: { gender, height, weight },
      });
      return res.data.data as PresetNearest;
    },
    enabled: Boolean(gender && height && weight),
  });
}
```

### Step 2 — Load GLB (đã có `@react-three/drei`)
```typescript
import { useGLTF } from '@react-three/drei';
const { scene } = useGLTF(preset.glbUrl);
```

### Step 3 — Áp morph targets sau khi GLB loaded
```typescript
// sau khi scene render xong / trong useFrame lần đầu
const meshes: THREE.Mesh[] = [];
scene.traverse((o) => {
  if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
});

meshes.forEach((mesh) => {
  const dict = mesh.morphTargetDictionary; // { name: index }
  if (!dict) return;
  for (const field of ['chest', 'waist', 'hip', 'shoulder']) {
    const delta = morphDeltasCm[field];
    const factor = morphFactors[field];
    const inf = Math.max(-1, Math.min(1, delta / factor));
    const incr = dict[`measure-${MORPH_NAME[field]}-incr`];
    const decr = dict[`measure-${MORPH_NAME[field]}-decr`];
    if (incr !== undefined) mesh.morphTargetInfluences![incr] = inf > 0 ? inf : 0;
    if (decr !== undefined) mesh.morphTargetInfluences![decr] = inf < 0 ? -inf : 0;
  }
});
```

### Step 4 — Tích hợp UI vào `MannequinViewer`
- Thêm mode `'geometry' | 'preset-glb'` (đã có sẵn kế hoạch Giai đoạn 3).
- Khi có `preset.glbUrl` → render GLB; khi chưa có → giữ geometry primitives cũ.
- **Giai đoạn 4 (morph sliders):** giữ state `morphDeltasCm` có thể kéo tay → gọi lại hàm Step 3 mỗi khi slider đổi (debounce 100–200ms). Slider điều chỉnh từng field trong khoảng `±2 × factor` cm.
- Nút "Thử ngay" → canvas capture → submit try-on như hiện tại.

### Step 5 — Fallback & Loading
- `useAvatarPreset` fail (mạng/5xx) → fallback về geometry primitives, bật cảnh báo nhẹ.
- Trong lúc `useGLTF` đang load → giữ spinner (GLB ~4.6MB).
- Nếu GLB **không có** morph (`morphTargetDictionary` undefined) → chỉ render preset thô, không áp morph (không crash).

---

## 5. BE Checklist (đã hoàn thành)

- [x] Migration: bảng `avatar_presets` — `{ id, gender, height, weight, glbUrl, presetMeasurements Json, createdAt, @@unique([gender, height, weight]) }`
- [x] Script offline `src/modules/avatar/scripts/generate-presets.ts` (`npm run presets:generate`):
  - Lưới mặc định: mỗi giới `height ∈ [150..190] bước 5` × `weight ∈ [40..100] bước 10` → 63 GLB/giới, ~126 GLB tổng.
  - Preset sinh với `force_morph_targets` (base macro-only + đủ 8 morph measure-*), upload Cloudinary `public_id = preset_<gender>_<height>_<weight>`, upsert DB.
  - Hỗ trợ `--gender`, `--height=a:b`, `--weight=a:b`, `--force`, `--no-upload`, `--limit` để chạy tiếp/resume.
- [x] Endpoint `GET /api/avatar/presets/nearest` + `GET /api/avatar/presets` (JwtAuthGuard).
- [x] E2E test `test/e2e/avatar.e2e-spec.ts` — 9 test (generate + presets).
- [x] Đã chạy thử thật: `preset_female_165_50/60` — GLB trên Cloudinary chứa đủ 8 morph measure-*.

> **Việc còn lại của BE:** chạy toàn bộ lưới `npm run presets:generate` (~126 GLB × ~24s ≈ 50–60 phút, một lần duy nhất). FE không phải chờ việc này để code — endpoint đã sẵn sàng trả theo dữ liệu có trong DB.

---

## 6. Lưu ý kỹ thuật

- **Giới hạn morph:** mỗi morph target ±2 đơn vị ⇒ điều chỉnh tối đa ±2×factor cm (vd bust ±33.8cm). Nếu user số đo lệch preset quá giới hạn → BE trả preset khác gần hơn, hoặc FE clamp và cảnh báo.
- **Chiều cao:** lưới preset cách nhau 5cm nên sai lệch ≤ ±2.5cm — chấp nhận được cho tỷ lệ. Không cần morph chiều cao.
- **GLB kích thước:** preset ~5.5MB (morph + draco). Tải nhiều preset song song → gộp `useGLTF` cache hoặc giới hạn preload 1–2 cái.
- **Cache:** preset bất biến → có thể đặt CDN/TTL dài hoặc dùng `cache-control: public, max-age=31536000` cho GLB.
- **Hiện tại:** endpoint `POST /avatar/generate` (Blender on-demand) **giữ nguyên** — dùng khi có ai cấu hình `BLENDER_PATH`; FE mặc định đi theo presets.

---

## 7. Thứ tự triển khai

1. BE làm mục 5 (migration + script + endpoint + test) → báo FE API ready.
2. FE Step 1 + Step 2: hook + load GLB, render preset thô (không morph) — MVP dùng được ngay.
3. FE Step 3: áp morph cho khớp số đo.
4. FE Step 4: sliders (Giai đoạn 4) + fallback hoàn chỉnh.
