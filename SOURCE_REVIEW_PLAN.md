# FashionAI Backend Source Review & Implementation Plan

Ngay lap: 2026-08-01

## 1. Tom Tat Hien Trang

Backend hien tai la NestJS API dung Prisma/PostgreSQL, co cac module chinh:

- `auth`: dang ky, dang nhap, refresh token, logout, logout-all.
- `users`: profile, measurements, quota endpoint.
- `try-on`: upload anh nguoi + anh trang phuc, goi fal.ai SAM2 + FASHN v1.6, stream anh ket qua.
- `stylist`: upload anh nguoi, goi Gemini Vision de phan tich va tu van phong cach.
- `database`: Prisma service/module.
- `common`: decorators, exception filter, response DTO, constants.

Ket qua kiem tra build:

- `npm.cmd run build`: thanh cong.
- `npm run build`: bi chan boi PowerShell execution policy tren may Windows, khong phai loi source code.

## 2. Cac Thanh Phan Da Co

### 2.1 Nen Tang

- NestJS 10.
- Prisma + PostgreSQL.
- Swagger/OpenAPI.
- Global validation pipe.
- Global exception filter.
- CORS config qua environment variables.
- Cookie parser cho refresh token cookie.

### 2.2 Auth

- Dang ky bang email/password.
- Dang nhap bang email/password.
- JWT access token.
- Refresh token rotation.
- Luu hash refresh token vao database.
- Logout phien hien tai.
- Logout tat ca phien cua user.
- `JwtAuthGuard`, `RolesGuard`, `CurrentUser`, `Public` decorators.

### 2.3 Users

- Lay profile hien tai.
- Cap nhat profile.
- Lay/cap nhat so do co the.
- Endpoint quota hien tai.

### 2.4 Try-On

- Multipart upload `humanImage` va `garmentImage`.
- Ho tro `garmentCategory`: upper, lower, full body.
- Upload anh len fal.storage.
- Co buoc SAM2 auto-segment garment.
- Goi FASHN v1.6.
- Download anh ket qua va stream ve client.

### 2.5 AI Stylist

- Multipart upload `humanImage`.
- Nhan `garmentDescription` va `occasion`.
- Goi Gemini Vision.
- Yeu cau model tra JSON gom body type, skin tone, personal color, outfit suggestions, verdict.

## 3. Cac Gap / Phan Con Thieu

### 3.1 Auth Chua Du Theo SRS

- Chua co verify email.
- Chua co forgot password.
- Chua co reset password.
- Chua co change password.
- Chua co Google OAuth.
- `JwtStrategy` hien tra `name`, `avatarUrl`, `isVerified` mac dinh, chua load user that tu DB.
- Chua co job cleanup refresh token het han.

### 3.2 Try-On Chua Co Bao Ve Chi Phi

- `POST /try-on` chua duoc bao ve bang `JwtAuthGuard`.
- Guest co the goi try-on truc tiep neu biet endpoint.
- Chua co quota guard.
- Chua co rate limiting.
- Chua co duplicate request protection.
- Chua co cache ket qua.
- Chua co try-on history.
- Chua ho tro `productId`; hien van upload garment tu do.
- `TIMEOUT_MS` duoc doc tu env nhung chua ap vao `fal.subscribe`.
- Chua luu anh ket qua vao object storage ben vung.

### 3.3 Database Schema Con Thieu

Schema hien chi co:

- `users`
- `measurements`
- `refresh_tokens`

Can bo sung:

- `products`
- `product_images` hoac truong anh san pham
- `try_on_results`
- `stylist_results`
- `orders`
- `payments`
- `password_reset_tokens`
- `email_verification_tokens`
- usage/quota table neu khong dung Redis hoan toan

### 3.4 Products/Admin Chua Co

- Chua co product catalog.
- Chua co API list/detail/search/filter san pham.
- Chua co CRUD san pham cho admin.
- Chua co upload anh san pham len Cloudinary/object storage.
- Chua co flow admin upload garment anh da chuan hoa de toi uu chi phi AI.
- `RolesGuard` da co nhung chua duoc ung dung vao module admin/product thuc te.

### 3.5 AI Stylist Chua Hoan Chinh

- Chua luu lich su tu van.
- Chua quota/rate limit cho Stylist.
- Chua retry/repair khi Gemini tra JSON sai format.
- Chua validate response schema truoc khi tra ve frontend.
- Gemini model dang hardcode trong source.

### 3.6 API Contract Chua Thong Nhat

Hien tai response format bi lech nhau:

- Auth tra wrapper: `{ success, code, message, data }`.
- Exception filter tra: `{ statusCode, message, path, timestamp }`.
- Users tra truc tiep entity.
- Try-On tra file anh truc tiep.
- Stylist tra truc tiep DTO.

Can chuan hoa response de frontend xu ly nhat quan.

### 3.7 Tai Lieu Va Developer Experience

- README bi loi encoding.
- README con noi ve Gradio/Kolors cu, trong khi source hien dung fal.ai/FASHN.
- README mo ta cau truc `src/try-on`, nhung source that nam trong `src/modules/try-on`.
- Mot so comment tieng Viet trong source bi loi encoding.
- Chua co script test chuan.
- Chua co test unit/e2e trong project.
- Cac file `test-api.ts`, `test-upload.ts`, `test-gemini-models.ts`, `test-gradio.mjs` la script roi, chua tich hop test runner.

### 3.8 Production Readiness Con Thieu

- Chua co request id/correlation id.
- Chua co structured logging.
- Chua co security headers.
- Chua co upload file size limit va MIME filter ro rang.
- Chua co monitoring chi phi fal.ai/Gemini.
- Chua co Dockerfile/docker-compose.
- Chua co CI/CD.
- Chua co health check tong hop database/AI provider.

## 4. Plan Trien Khai Chi Tiet

## Phase 0 - On Dinh Nen Tang

Muc tieu: lam source ro rang, API contract nhat quan, de frontend tich hop it loi.

- [ ] Sua README, GETTING_STARTED va cac comment bi loi encoding.
- [ ] Cap nhat README theo source hien tai: NestJS modules, fal.ai, Gemini, Prisma.
- [ ] Chuan hoa response success cho cac endpoint JSON.
- [ ] Chuan hoa error response trong `GlobalExceptionFilter`.
- [ ] Quyet dinh cach tra ket qua Try-On: stream file truc tiep hay tra JSON kem `resultUrl`.
- [ ] Them upload limit: max file size, allowed MIME types.
- [ ] Dua `FASHN_MODEL`, `SAM2_MODEL`, `GEMINI_MODEL`, timeout, FASHN mode vao env.
- [ ] Ap dung timeout thuc te cho fal.ai/Gemini.
- [ ] Them scripts: `test`, `test:watch`, `test:e2e`, `lint:check`.

## Phase 1 - Auth & User Hoan Chinh

Muc tieu: hoan thien flow tai khoan theo SRS.

- [ ] Cap nhat `JwtStrategy` de validate user con ton tai trong DB.
- [ ] Tra ve `name`, `avatarUrl`, `tier`, `role`, `isVerified` theo DB.
- [ ] Them endpoint change password.
- [ ] Them bang `password_reset_tokens`.
- [ ] Them forgot password endpoint.
- [ ] Them reset password endpoint.
- [ ] Them bang `email_verification_tokens`.
- [ ] Them email verification flow.
- [ ] Them mail service.
- [ ] Them Google OAuth neu frontend can social login.
- [ ] Them cleanup job cho refresh/reset/verification token het han.

## Phase 2 - Quota, Rate Limit & Cost Control

Muc tieu: ngan viec goi AI khong kiem soat va bao ve chi phi.

- [ ] Them `JwtAuthGuard` cho `POST /try-on`.
- [ ] Thiet ke quota theo tier:
  - Guest: 0 luot.
  - Free: 3 luot/ngay.
  - Member: 10 luot/ngay.
  - VIP: unlimited.
- [ ] Tao `TryOnQuotaGuard`.
- [ ] Chon Redis hoac DB cho daily usage tracking.
- [ ] Neu dung Redis: key dang `tryon:quota:{userId}:{date}`, co TTL den midnight.
- [ ] Neu dung DB: them bang `ai_usage_logs` hoac `daily_usage`.
- [ ] Tra `429` kem `{ used, limit, remaining, resetAt }`.
- [ ] Khong tru quota khi cache hit.
- [ ] Them duplicate request lock theo user/input hash.
- [ ] Them rate limit chung cho Auth/Try-On/Stylist.

## Phase 3 - Products & Admin

Muc tieu: xay catalog san pham de try-on bang `productId`, giam upload tu do va giam chi phi.

- [ ] Them Prisma model `Product`.
- [ ] Them Prisma model `ProductImage` neu can nhieu anh.
- [ ] Them fields: name, description, category, color, size, price, garmentUrl, status.
- [ ] Tao `ProductsModule`.
- [ ] Tao `GET /products` co filter category, size, color, price.
- [ ] Tao `GET /products/:id`.
- [ ] Tao `POST /products` admin only.
- [ ] Tao `PUT /products/:id` admin only.
- [ ] Tao `DELETE /products/:id` admin only.
- [ ] Tich hop object storage/Cloudinary cho upload anh san pham.
- [ ] Ap dung `RolesGuard` cho API admin.
- [ ] Cap nhat Swagger cho product endpoints.

## Phase 4 - Try-On History & Cache

Muc tieu: luu ket qua try-on, cho xem lai khong ton quota, ho tro cache.

- [ ] Them Prisma model `TryOnResult`.
- [ ] Luu `userId`, `productId`, `humanImageHash`, `garmentImageHash`, `category`, `resultUrl`.
- [ ] Luu provider metadata: model, duration, status, error, cost estimate neu co.
- [ ] Upload result image vao object storage ben vung.
- [ ] Tao input hash de cache.
- [ ] Neu cung input va cache con hop le, tra ket qua cu.
- [ ] API `GET /try-on/history`.
- [ ] API `GET /try-on/history/:id`.
- [ ] API `DELETE /try-on/history/:id`.
- [ ] Cho `POST /try-on` nhan `productId` hoac `garmentImage`, uu tien `productId`.
- [ ] Cap nhat quota logic: cache hit khong tinh usage.

## Phase 5 - AI Stylist History & Reliability

Muc tieu: Stylist co lich su, output on dinh, chi phi duoc kiem soat.

- [ ] Them Prisma model `StylistResult`.
- [ ] Luu prompt input, garment description, occasion, JSON result.
- [ ] API `GET /stylist/history`.
- [ ] Them quota/rate limit cho Stylist theo tier.
- [ ] Dua Gemini model vao env.
- [ ] Validate JSON response bang DTO/schema.
- [ ] Them retry/repair prompt khi Gemini tra sai JSON.
- [ ] Xu ly safety/error response ro rang.

## Phase 6 - Orders, Payments & Tier Upgrade

Muc tieu: ho tro nang cap tier sau khi mua hang/thanh toan.

- [ ] Them Prisma model `Order`.
- [ ] Them Prisma model `Payment`.
- [ ] Them status lifecycle: pending, paid, cancelled, expired, failed.
- [ ] Tich hop PayOS theo env hien co.
- [ ] Tao checkout/payment endpoint.
- [ ] Tao webhook endpoint.
- [ ] Bao dam webhook idempotent.
- [ ] Khi payment success, update user tier.
- [ ] Ghi lai tier history neu can audit.

## Phase 7 - Test, CI/CD & Production

Muc tieu: dam bao source on dinh khi deploy va khi team tiep tuc phat trien.

- [ ] Unit test `AuthService`.
- [ ] Unit test `TokenService`.
- [ ] Unit test `UsersService`.
- [ ] Unit test quota guard.
- [ ] E2E auth flow: register, login, refresh, logout.
- [ ] E2E protected route.
- [ ] E2E quota exceeded.
- [ ] Mock fal.ai/Gemini trong test.
- [ ] Dockerfile.
- [ ] docker-compose cho app + postgres + redis.
- [ ] CI build/lint/test.
- [ ] Health check tong hop DB/Redis.
- [ ] Structured logging.
- [ ] Request id middleware.
- [ ] Monitoring latency/error/cost cua AI provider.

## 5. Thu Tu Uu Tien De Lam MVP

De nhanh co backend MVP dung duoc va khong dot chi phi AI, nen lam theo thu tu:

1. Phase 0: sua docs/encoding, chuan hoa response, upload validation, timeout.
2. Phase 2: khoa `POST /try-on` bang auth, them quota/rate limit.
3. Phase 4: them try-on history va cache.
4. Phase 3: them product catalog va try-on bang `productId`.
5. Phase 5: them stylist history va harden Gemini output.
6. Phase 1: bo sung auth nang cao nhu forgot password, verify email, Google OAuth.
7. Phase 6-7: payment, tier upgrade, test, CI/CD, production hardening.

## 6. Rủi Ro Chinh

- Fal.ai/Gemini co the ton chi phi cao neu endpoint khong co auth/quota/cache.
- Frontend se kho tich hop neu response format tiep tuc khong nhat quan.
- Ket qua AI khong nen chi stream truc tiep neu can history/cache/download ve sau.
- Upload anh tu do co the lam tang chi phi va rui ro noi dung khong hop le.
- Thieu test e2e lam cac flow auth/token/quota de bi regression.

## 7. De Xuat Quyet Dinh Ky Thuat

- Dung Redis cho quota daily va duplicate request lock.
- Dung PostgreSQL de luu history, products, payments, token reset.
- Dung object storage/Cloudinary de luu product images va try-on result images.
- Response JSON nen theo format chung:

```json
{
  "success": true,
  "code": "SOME_CODE",
  "message": "Human readable message",
  "timestamp": "2026-08-01T00:00:00.000Z",
  "path": "/api/example",
  "data": {}
}
```

- Error JSON nen theo format chung:

```json
{
  "success": false,
  "code": "ERROR_CODE",
  "message": "Human readable error",
  "timestamp": "2026-08-01T00:00:00.000Z",
  "path": "/api/example",
  "details": {}
}
```

- Với Try-On, nen uu tien tra JSON kem `resultUrl` sau khi upload anh ket qua vao storage. Chi dung stream file truc tiep neu frontend thuc su can download ngay.
