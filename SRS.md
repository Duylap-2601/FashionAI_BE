# 📄 Software Requirements Specification (SRS)
# FashionAI — Nền tảng Thử Đồ Ảo AI cho Trang Phục Công Sở

**Phiên bản:** 1.0  
**Ngày:** 2026-06-09  
**Trạng thái:** Draft

---

## 1. Tổng Quan Hệ Thống

### 1.1 Mục Đích
FashionAI là nền tảng thương mại điện tử thông minh chuyên về **trang phục công sở và suit** (office wear), tích hợp AI để:
- Cho phép người dùng **thử đồ ảo** (Virtual Try-On) trực tiếp trên hình ảnh hoặc mannequin 3D
- Cung cấp **tư vấn phong cách** (AI Stylist) cá nhân hóa theo dáng người, màu da, dịp mặc
- Tái sử dụng **số đo cơ thể** để cải thiện độ chính xác kết quả try-on

### 1.2 Phạm Vi
- **Backend:** NestJS API (đã có)
- **Frontend:** Next.js 14 (sẽ xây dựng)
- **AI Services:** fal.ai (SAM2 + FASHN v1.6), Google Gemini Vision
- **Target users:** Người đi làm, nhân viên văn phòng, người mua sắm suit/công sở online

### 1.3 Định Nghĩa & Thuật Ngữ

| Thuật ngữ | Định nghĩa |
|---|---|
| Try-On | Thử đồ ảo: ghép ảnh trang phục lên ảnh người hoặc mannequin |
| SAM2 | Segment Anything Model 2 — AI tách background garment |
| FASHN | Model AI thực hiện virtual try-on (fal.ai) |
| Mannequin | Ma-nơ-canh 3D được tạo từ số đo cơ thể người dùng |
| Quota | Số lượt try-on tối đa mỗi ngày theo tier người dùng |
| Cache | Lưu kết quả try-on để tránh gọi API lại khi cùng input |

---

## 2. Vai Trò Người Dùng

### 2.1 Guest (Khách vãng lai)
- Xem danh sách sản phẩm
- Xem chi tiết sản phẩm
- **Không** được dùng Try-On và AI Stylist
- Phải đăng nhập để tiếp tục

### 2.2 Free User (Người dùng miễn phí)
- Đăng ký tài khoản, chưa mua hàng
- **3 lượt Try-On / ngày**
- Sử dụng AI Stylist (giới hạn 3 lần/ngày)
- Lưu số đo cơ thể
- Xem lịch sử try-on

### 2.3 Member (Thành viên — đã mua ≥ 1 đơn)
- **10 lượt Try-On / ngày**
- Không giới hạn AI Stylist
- Ưu tiên xử lý (queue thấp hơn)

### 2.4 VIP (Thành viên VIP — mua thường xuyên)
- **Không giới hạn Try-On**
- Xử lý ưu tiên cao nhất
- Lưu unlimited Try-On history

### 2.5 Admin
- Quản lý sản phẩm (CRUD)
- Xem thống kê sử dụng API (credits consumed, quota usage)
- Cấu hình quota theo tier
- Quản lý người dùng

---

## 3. Yêu Cầu Chức Năng (Functional Requirements)

### FR-01: Xác Thực & Tài Khoản

| ID | Chức năng | Mô tả |
|---|---|---|
| FR-01-1 | Đăng ký | Email + password, xác thực email |
| FR-01-2 | Đăng nhập | Email/password hoặc Google OAuth |
| FR-01-3 | Refresh Token | JWT access (15 phút) + refresh (30 ngày) |
| FR-01-4 | Đổi mật khẩu | Cần nhập mật khẩu cũ |
| FR-01-5 | Quên mật khẩu | Gửi link reset qua email |

---

### FR-02: Quản Lý Số Đo Cơ Thể

| ID | Chức năng | Mô tả |
|---|---|---|
| FR-02-1 | Nhập số đo | height, weight, chest, waist, hip, shoulder |
| FR-02-2 | Cập nhật số đo | Chỉnh sửa, có trạng thái "unsaved" nếu chưa lưu |
| FR-02-3 | Xem số đo | Hiển thị trong Profile và Try-On page |
| FR-02-4 | Onboarding prompt | Nhắc nhở nhập số đo lần đầu (có thể bỏ qua) |
| FR-02-5 | Auto-load Try-On | BE tự đọc measurements từ user profile, không cần FE gửi lại |

**Validation:**
- Chiều cao: 100–250 cm
- Cân nặng: 30–300 kg
- Vòng ngực/eo/hông: 50–200 cm
- Chiều rộng vai: 30–80 cm

---

### FR-03: Danh Mục Sản Phẩm

| ID | Chức năng | Mô tả |
|---|---|---|
| FR-03-1 | Xem danh sách | Lọc theo category, size, màu, giá |
| FR-03-2 | Xem chi tiết | Ảnh, mô tả, giá, size chart, nút "Thử ngay" |
| FR-03-3 | Tìm kiếm | Full-text search theo tên, mô tả |
| FR-03-4 | CRUD sản phẩm | Admin only |
| FR-03-5 | Upload ảnh sản phẩm | Admin upload, lưu vào storage |

**Categories:**
- `tops` — Áo sơ mi, áo blouse, blazer đơn
- `bottoms` — Quần tây, váy công sở
- `one-pieces` — Suit đầy đủ, váy liền, jumpsuit

---

### FR-04: Virtual Try-On (Tính năng cốt lõi)

| ID | Chức năng | Mô tả |
|---|---|---|
| FR-04-1 | Try-On từ sản phẩm | Chọn sản phẩm → Try-On ngay, không cần upload garment |
| FR-04-2 | Try-On với ảnh upload | Upload ảnh người + ảnh đồ → kết quả |
| FR-04-3 | Try-On với mannequin | Dùng mannequin 3D render từ số đo người dùng |
| FR-04-4 | SAM2 preprocessing | Tự động tách background garment trước khi try-on |
| FR-04-5 | Xem kết quả | Hiển thị ảnh kết quả, có thể tải về |
| FR-04-6 | So sánh | Hiển thị ảnh trước/sau cạnh nhau |
| FR-04-7 | Lưu vào lịch sử | Tự động lưu kết quả vào Try-On History |
| FR-04-8 | Cache kết quả | Cùng input → không gọi API lại, trả về cache |

**Pipeline kỹ thuật:**
```
Upload/Render ảnh → fal.storage → SAM2 → FASHN v1.6 balanced → cache → Stream về FE
```

---

### FR-05: Quota & Rate Limiting

| ID | Chức năng | Mô tả |
|---|---|---|
| FR-05-1 | Giới hạn try-on/ngày | Theo tier: Guest=0, Free=3, Member=10, VIP=∞ |
| FR-05-2 | Không tính cache hit | Xem lại kết quả cũ → không trừ quota |
| FR-05-3 | Hiển thị quota | FE hiện "Còn X lượt hôm nay" |
| FR-05-4 | Thông báo hết quota | Toast + CTA mua hàng để nâng tier |
| FR-05-5 | Reset hàng ngày | Quota reset lúc 00:00 mỗi ngày |
| FR-05-6 | Upgrade tier | Mua hàng → tự động nâng tier Member |

---

### FR-06: AI Stylist

| ID | Chức năng | Mô tả |
|---|---|---|
| FR-06-1 | Phân tích ảnh người | Gemini Vision phân tích dáng người, màu da |
| FR-06-2 | Tư vấn phong cách | Personal Color Season, fit recommendation |
| FR-06-3 | Gợi ý outfit | 3 bộ outfit hoàn chỉnh (áo + quần + giày + phụ kiện) |
| FR-06-4 | Nhận xét trang phục | Trang phục này có phù hợp không và tại sao |
| FR-06-5 | Lưu kết quả | Lưu lịch sử tư vấn |

---

### FR-07: Try-On History

| ID | Chức năng | Mô tả |
|---|---|---|
| FR-07-1 | Xem lịch sử | Danh sách các lần try-on đã thực hiện |
| FR-07-2 | Xem lại kết quả | Mở lại ảnh kết quả từ history (không tốn quota) |
| FR-07-3 | Xóa lịch sử | Xóa từng item hoặc xóa tất cả |
| FR-07-4 | Tải ảnh kết quả | Download ảnh try-on về máy |

---

### FR-08: 3D Mannequin (Phase 2)

| ID | Chức năng | Mô tả |
|---|---|---|
| FR-08-1 | Generate Avatar 3D | API nhận số đo người dùng và tạo model 3D (GLB) |
| FR-08-2 | Blender Headless | Dùng `child_process.exec` gọi script Python chạy ngầm trên máy chủ |
| FR-08-3 | MPFB2 Target Mapping | Áp dụng tự động các thanh trượt `measure-*` tương ứng số đo |
| FR-08-4 | Render mannequin | Frontend dùng Three.js render file GLB trả về từ Backend |
| FR-08-5 | Capture render | Chụp ảnh Canvas (3D viewer) thành Blob → gửi làm `human_img` cho FASHN |
| FR-08-6 | Cập nhật số đo | Đồng bộ hóa số đo đã nhập vào hồ sơ người dùng |

**Luồng kỹ thuật tự động hóa (Blender Headless Pipeline):**
1. **Client** gửi các số đo cơ thể (height, chest, waist, hips...) lên **Backend** (NestJS - `AvatarService`).
2. **Backend** sinh file JSON tạm thời chứa số đo (VD: `measurements_123.json`).
3. **Backend** thực thi tiến trình con gọi Blender chạy ngầm không giao diện:
   `blender -b -P generate_avatar.py -- --input measurements_123.json --output avatar_123.glb`
4. **Blender Python Script (`generate_avatar.py`)** thực thi:
   - Import và khởi tạo Add-on MPFB2.
   - Sinh ra phôi người (Basemesh).
   - Đọc JSON và điều chỉnh tự động các Morph Targets tương ứng (VD: `measure-bust-circ-decr-incr`).
   - Kết xuất (Export) người mẫu ra file `avatar_123.glb`.
5. **Backend** nhận file `.glb`, tải lên cloud storage (S3/Cloudinary/Fal) và trả URL cho Client.
6. **Frontend** dùng `@react-three/fiber` để load và tương tác 3D với model.

---

## 4. Yêu Cầu Phi Chức Năng (Non-Functional Requirements)

### 4.1 Hiệu Năng (Performance)
- Try-On response time: < 30 giây (balanced mode)
- Cache hit response time: < 200ms
- API response (non-AI): < 500ms
- Concurrent users: hỗ trợ 50 requests đồng thời

### 4.2 Bảo Mật (Security)
- JWT Authentication (access token 15 phút, refresh 30 ngày)
- CORS chỉ cho phép domain FE
- Rate limiting: 100 request/phút/IP (global)
- Input validation trên tất cả endpoints
- Không lộ API keys (FAL_KEY, GEMINI_API_KEY) ra client

### 4.3 Độ Tin Cậy (Reliability)
- SAM2 failure → fallback về garment gốc (không throw error)
- fal.ai timeout (120s) → trả về 408, không crash server
- Cache expiry → tự động gọi lại API, transparent với người dùng

### 4.4 Khả Năng Mở Rộng (Scalability)
- Stateless BE → dễ horizontal scale
- Redis cache → shared state giữa nhiều instances
- fal.ai serverless → không cần quản lý GPU

### 4.5 Chi Phí (Cost) & Chiến Lược Tối Ưu Hóa (Cost Optimization)
Để đảm bảo hệ thống vận hành với chi phí tối ưu nhất, đặc biệt đối với API fal.ai, các chiến lược sau phải được áp dụng:

**1. Chiến lược "Pre-compute" (Sinh ảnh sẵn) cho Free Users:**
- Khởi tạo 3 - 5 người mẫu tiêu chuẩn (Mannequin 3D hoặc người mẫu thật với các dáng: Gầy, Vừa, Mũm mĩm, Cao...).
- Khi nhập sản phẩm mới (VD: Áo sơ mi A), chạy script ngầm gọi fal.ai để mặc áo này lên 5 người mẫu chuẩn, chạy 1 lần và lưu Cache.
- **Quy tắc:** Guest và Free User chỉ được thử đồ trên mannequin tiêu chuẩn (không upload ảnh cá nhân). Đạt tỉ lệ **Cache Hit 100%**, chi phí API cho nhóm này = $0.

**2. Tắt SAM2 trên fal.ai và tự xử lý:**
- Tắt SAM2 trên fal.ai (`SAM2_ENABLED=false`) để giảm phí + thời gian GPU.
- **Giải pháp thay thế:** Admin chỉ upload ảnh sản phẩm đã xóa phông sẵn (trong suốt PNG) HOẶC xây dựng microservice/tích hợp API ngoài (Photoroom/rembg) để tách nền trước khi gửi vào fal.ai. Đầu vào sạch sẽ giúp FASHN chạy nhanh và rẻ hơn.

**3. Tối ưu tham số gọi API FASHN:**
- **Inference Optimization:** Tùy chỉnh payload FASHN để giảm số bước suy luận (`num_inference_steps`), ví dụ từ 30 xuống 20 để giảm thời gian chạy GPU.
- Sử dụng chế độ `mode: "balanced"` (hoặc `performance`) thay vì `quality`.

**4. Dùng Gemini (Free) làm "Bảo vệ" chặn ảnh rác:**
- Sử dụng hạn mức 1,500 lượt miễn phí/ngày của Gemini 1.5 Flash.
- **Flow:** Trước khi chuyển tiếp ảnh user upload sang fal.ai, gọi Gemini kiểm tra *"Đây có phải người thật đứng thẳng và rõ nét không?"*. Nếu không hợp lệ, từ chối Try-On ngay lập tức để không lãng phí tiền chạy GPU của fal.ai.

**5. Cấu hình Frontend chống "Double-click" (Abuse prevention):**
- Ngay khi người dùng nhấn "Thử ngay", lập tức `disable` nút bấm (làm mờ, xoay loading) và chặn tất cả các request trùng lặp từ Client cho đến khi nhận được kết quả, tránh việc user mất kiên nhẫn bấm nhiều lần gây tốn API quota.

---

## 5. Thiết Kế Cơ Sở Dữ Liệu

### 5.1 Sơ đồ ERD (Text)

```
users ──────────────── measurements
  │ 1                      1 │
  │                          │
  │ 1                        │
  ├── orders (1:N)           │
  │     │ 1:N                │
  │     └── order_items      │
  │           │ N:1          │
  │           └──── products │
  │                          │
  │ 1                        │
  └── try_on_results (1:N) ──┘
        │ N:1
        └── products
```

---

### 5.2 Chi Tiết Bảng

#### `users`
```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),                    -- NULL nếu dùng OAuth
  name          VARCHAR(100),
  avatar_url    TEXT,
  provider      VARCHAR(20) DEFAULT 'local',     -- 'local' | 'google'
  provider_id   VARCHAR(255),                    -- Google sub
  tier          VARCHAR(20) DEFAULT 'free',      -- 'free' | 'member' | 'vip' | 'admin'
  is_verified   BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);
```

#### `measurements`
```sql
CREATE TABLE measurements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  height      DECIMAL(5,1),    -- cm (100–250)
  weight      DECIMAL(5,1),    -- kg (30–300)
  chest       DECIMAL(5,1),    -- cm
  waist       DECIMAL(5,1),    -- cm
  hip         DECIMAL(5,1),    -- cm
  shoulder    DECIMAL(5,1),    -- cm — quan trọng cho suit
  updated_at  TIMESTAMP DEFAULT NOW()
);
```

#### `products`
```sql
CREATE TABLE products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  description   TEXT,
  price         DECIMAL(12,2) NOT NULL,
  category      VARCHAR(20) NOT NULL,       -- 'tops' | 'bottoms' | 'one-pieces'
  brand         VARCHAR(100),
  images        JSONB DEFAULT '[]',         -- [{ url, isPrimary }]
  garment_url   TEXT NOT NULL,              -- URL ảnh sản phẩm cho Try-On
  sizes         JSONB DEFAULT '[]',         -- ['S','M','L','XL']
  colors        JSONB DEFAULT '[]',         -- [{ name, hex }]
  stock         INTEGER DEFAULT 0,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);
```

#### `orders`
```sql
CREATE TABLE orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id),
  status          VARCHAR(20) DEFAULT 'pending',  -- pending|confirmed|shipped|delivered|cancelled
  total_amount    DECIMAL(12,2) NOT NULL,
  shipping_info   JSONB,                           -- { name, phone, address }
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);
```

#### `order_items`
```sql
CREATE TABLE order_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_id  UUID REFERENCES products(id),
  quantity    INTEGER NOT NULL DEFAULT 1,
  size        VARCHAR(10),
  color       VARCHAR(50),
  price       DECIMAL(12,2) NOT NULL    -- giá tại thời điểm đặt hàng
);
```

#### `try_on_results`
```sql
CREATE TABLE try_on_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  product_id      UUID REFERENCES products(id),   -- NULL nếu upload tự do
  category        VARCHAR(20) NOT NULL,
  human_img_hash  VARCHAR(32),    -- MD5 của human image
  garment_img_hash VARCHAR(32),   -- MD5 của garment image
  cache_key       VARCHAR(100) UNIQUE,
  result_url      TEXT NOT NULL,  -- URL ảnh kết quả (lưu ở storage của mình)
  mode            VARCHAR(20) DEFAULT 'balanced',
  created_at      TIMESTAMP DEFAULT NOW(),
  expires_at      TIMESTAMP DEFAULT NOW() + INTERVAL '30 days'
);
```

#### `stylist_results`
```sql
CREATE TABLE stylist_results (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
  garment_description TEXT,
  occasion            VARCHAR(100),
  body_type           VARCHAR(50),
  skin_tone           VARCHAR(50),
  personal_color      VARCHAR(50),
  fit_recommendation  VARCHAR(50),
  color_suggestions   JSONB,
  outfit_combinations JSONB,
  styling_tips        TEXT,
  verdict             TEXT,
  created_at          TIMESTAMP DEFAULT NOW()
);
```

#### `refresh_tokens`
```sql
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) UNIQUE NOT NULL,
  expires_at  TIMESTAMP NOT NULL,
  created_at  TIMESTAMP DEFAULT NOW()
);
```

---

## 6. API Endpoints

### Auth
```
POST   /auth/register          Đăng ký tài khoản
POST   /auth/login             Đăng nhập → { accessToken, refreshToken }
POST   /auth/refresh           Refresh access token
POST   /auth/logout            Revoke refresh token
POST   /auth/forgot-password   Gửi email reset password
POST   /auth/reset-password    Reset password với token
GET    /auth/google            OAuth Google redirect
GET    /auth/google/callback   OAuth Google callback
```

### Users & Measurements
```
GET    /users/me               Thông tin user hiện tại
PUT    /users/me               Cập nhật thông tin profile
GET    /users/me/measurements  Lấy số đo cơ thể
PUT    /users/me/measurements  Cập nhật số đo
GET    /users/me/quota         Quota còn lại hôm nay
```

### Products
```
GET    /products               Danh sách sản phẩm (filter, search, paginate)
GET    /products/:id           Chi tiết sản phẩm
POST   /products               Tạo sản phẩm [Admin]
PUT    /products/:id           Cập nhật sản phẩm [Admin]
DELETE /products/:id           Xóa sản phẩm [Admin]
```

### Try-On
```
POST   /try-on                 Virtual try-on (upload humanImage + productId hoặc garmentImage)
GET    /try-on/history         Lịch sử try-on của user
GET    /try-on/history/:id     Chi tiết 1 lần try-on
DELETE /try-on/history/:id     Xóa 1 item khỏi lịch sử
GET    /try-on/health          Health check
```

### Stylist
```
POST   /stylist/analyze        Phân tích ảnh + tư vấn phong cách
GET    /stylist/history        Lịch sử tư vấn
```

### Orders
```
POST   /orders                 Tạo đơn hàng
GET    /orders                 Danh sách đơn của user
GET    /orders/:id             Chi tiết đơn hàng
PATCH  /orders/:id/cancel      Hủy đơn hàng
```

---

## 7. Kiến Trúc Hệ Thống

```
┌──────────────────────────────────────────────────────┐
│                    CLIENT LAYER                       │
│  Next.js 14 (App Router)                             │
│  Three.js Mannequin │ React Query │ Zustand           │
└───────────────────────────┬──────────────────────────┘
                            │ HTTPS
┌───────────────────────────▼──────────────────────────┐
│                   BACKEND LAYER                       │
│  NestJS (TypeScript)                                 │
│                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ ┌────────┐│
│  │   Auth   │ │ Try-On   │ │ Stylist  │ │Products│ │ Avatar ││
│  │  Module  │ │  Module  │ │  Module  │ │ Module │ │ Module ││
│  └──────────┘ └────┬─────┘ └────┬─────┘ └────────┘ └────────┘│
│                    │             │                    │
│  ┌─────────────────▼─────────────▼────────────────┐ │
│  │              Guard Layer                        │ │
│  │  JwtAuthGuard │ TryOnQuotaGuard │ RolesGuard    │ │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │              Cache Layer (Redis)                │ │
│  │  try-on results │ quota tracking │ session       │ │
│  └─────────────────────────────────────────────────┘ │
└──────────────┬───────────────────┬───────────────────┘
               │                   │
┌──────────────▼──────┐  ┌────────▼──────────────────┐
│   PostgreSQL DB     │  │      External Services    │
│  users              │  │  fal.ai (SAM2 + FASHN)    │
│  measurements       │  │  Google Gemini Vision     │
│  products           │  │  Blender + MPFB2 (CLI)    │
│  orders             │  └───────────────────────────┘
│  try_on_results     │
│  stylist_results    │
└─────────────────────┘
```

---

## 8. Tech Stack

### Backend
| Layer | Công nghệ |
|---|---|
| Framework | NestJS 10 + TypeScript 5 |
| Database | PostgreSQL + TypeORM hoặc Prisma |
| Cache | Redis (ioredis) |
| Auth | JWT + Passport.js (Local + Google OAuth) |
| File Upload | Multer (buffer) → fal.storage |
| Validation | class-validator + class-dto |
| Docs | Swagger/OpenAPI |
| AI: Try-On | fal.ai (SAM2 + FASHN v1.6) |
| AI: Stylist | Google Gemini Vision |

### Frontend
| Layer | Công nghệ |
|---|---|
| Framework | Next.js 14 (App Router) |
| 3D | Three.js + @react-three/fiber + @react-three/drei |
| State | Zustand |
| Server State | TanStack React Query |
| Forms | React Hook Form + Zod |
| Styling | Vanilla CSS + CSS Modules |
| Auth | NextAuth.js |
| HTTP | Axios |

### Infrastructure
| Layer | Công nghệ |
|---|---|
| Containerization | Docker + Docker Compose |
| Storage | Local (dev) / Cloudinary hoặc S3 (prod) |
| Deployment | Railway / Render / VPS |

---

## 9. Thứ Tự Triển Khai (Implementation Priority)

### Phase 1 — Core Foundation *(Làm trước)*
- [ ] Setup PostgreSQL + TypeORM/Prisma
- [ ] Tạo đầy đủ các entity (users, measurements, products, orders, try_on_results)
- [ ] Auth module (register, login, JWT, refresh token)
- [ ] Users/Measurements module (CRUD số đo)
- [ ] Products module (CRUD sản phẩm — admin)
- [ ] JwtAuthGuard áp dụng cho Try-On

### Phase 2 — Try-On Optimization
- [ ] TryOnQuotaGuard (Redis, quota theo tier)
- [ ] Cache layer (hash input → lưu result vào storage)
- [ ] Try-On History (lưu DB + API GET history)
- [ ] Refactor Try-On nhận `productId` thay vì garmentImage upload tự do

### Phase 3 — Frontend
- [ ] Setup Next.js 14 + folder structure
- [ ] Auth pages (login, register)
- [ ] Product catalog + chi tiết sản phẩm
- [ ] Try-On page (upload ảnh + xem kết quả)
- [ ] Profile page + Measurements form
- [ ] Try-On History UI

### Phase 4 — 3D Mannequin *(Phase cuối)*
- [ ] Three.js MannequinViewer component
- [ ] Morph targets theo số đo
- [ ] Canvas render → gửi lên BE
- [ ] Sync số đo từ slider → Profile

---

## 10. Các Rủi Ro & Giảm Thiểu

| Rủi ro | Mức độ | Giảm thiểu |
|---|---|---|
| fal.ai credit hết | Cao | Quota + cache + monitoring |
| SAM2 output không đúng | Trung bình | Fallback về garment gốc |
| FASHN chất lượng thấp với ảnh xấu | Trung bình | Hướng dẫn chụp ảnh chuẩn |
| Người dùng lạm dụng Try-On | Cao | Rate limiting + quota theo tier |
| 3D mannequin morph không chính xác | Trung bình | Dùng preset S/M/L/XL/XXL thay vì tùy chỉnh |
| fal.ai URL expire sau 1h | Thấp | Download và lưu ở storage mình |

---

*Tài liệu này sẽ được cập nhật khi có thay đổi yêu cầu hoặc quyết định kỹ thuật mới.*
