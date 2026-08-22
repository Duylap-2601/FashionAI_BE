# Software Requirements Specification - FashionAI

Version: 2.0
Updated: 2026-08-22
Status: Current - aligned with backend source

## 1. Overview

FashionAI is an AI-assisted fashion platform focused on office wear and suits. The backend provides APIs for authentication, product catalog, body measurements, virtual try-on, AI styling advice, AI chatbot, 3D avatar generation, quota control, tier upgrades through payment, and transactional email.

Frontend is expected to be a separate Next.js application.

## 2. User Roles And Tiers

### Guest

- Can view product catalog and product detail.
- Cannot use Virtual Try-On, AI Stylist, or Chatbot.
- Must log in before using protected AI endpoints.

### Free User

- Can save profile and body measurements.
- Can use limited AI quota per day:
  - Try-On: 3/day
  - Stylist: 3/day
  - Chatbot: 50/day

### Member

- Higher daily AI quotas:
  - Try-On: 10/day
  - Stylist: 20/day
  - Chatbot: 200/day
- Can be upgraded after successful payment.

### VIP

- Unlimited AI quota for all configured actions.
- Can be upgraded after successful payment.

### Admin

- Can create, update, and delete products.
- Future: manage users, quota configuration, and usage statistics.

## 3. Functional Requirements

### FR-01 Authentication And Account

Required:

- Register with email/password.
- Login with email/password.
- Google OAuth login.
- JWT access token (15m).
- Refresh token rotation (30d, HttpOnly cookie).
- Logout current session.
- Logout all sessions.
- Change password.
- Forgot password / Reset password.
- Verify email / Resend verification.

Current status: ✅ **Implemented**

Completed:
- ✅ Token cleanup cron job (MAINTENANCE_CRON_ENABLED)
- ✅ OAuth state/CSRF behavior verified
- ✅ Token blacklist support
- ✅ Token rotation with refresh cookie

### FR-02 Body Measurements

Required fields (15 total):

**Basic (6):**
- height (100-250 cm)
- weight (30-300 kg)
- chest (50-200 cm)
- waist (50-200 cm)
- hip (50-200 cm)
- shoulder (30-80 cm)

**Advanced (9):**
- neck (28-55 cm)
- sleeveLength (45-80 cm)
- wrist (12-25 cm)
- thigh (35-90 cm)
- inseam (55-95 cm)
- knee (25-55 cm)
- calf (25-55 cm)
- shirtLength (50-85 cm)
- underbust (55-130 cm)

Validation: all via class-validator in DTO with min/max.

Current status: ✅ **Implemented** (15 fields + FE aliases bodyLength/trouserLength)

### FR-03 Product Catalog

Required:

- Public product list with pagination.
- Public product detail.
- Search by name/description.
- Filter by category (UPPER/LOWER/FULL_BODY), size, color, price range.
- Admin-only create/update/delete with multipart image upload.

Current status: ✅ **Implemented**

Completed:
- ✅ Admin multipart image upload (Cloudinary/StorageService)
- ✅ Rich catalog fields: brand, stock, colors[], sizes[], description
- ✅ Product status: DRAFT/ACTIVE/ARCHIVED

### FR-04 Virtual Try-On

Required:

- Try-On using product catalog item (`productId`).
- Try-On using uploaded garment image (`garmentImage`).
- Upload human image (`humanImage`).
- Category mapping: UPPER/LOWER/FULL_BODY.
- Optional SAM2 preprocessing (fal-ai/sam2/auto-segment).
- FASHN virtual try-on (fal-ai/fashn/tryon/v1.6).
- Configurable mode: balanced/quality.
- Return result URL (permanent Cloudinary storage).
- Save result history with cacheKey/expiresAt.
- Cache by (userId + humanHash + garmentHash + category).
- Cache hit returns instantly, no quota consumed.
- Download result endpoint (`GET /api/try-on/history/:id/download`).
- Delete single & delete-all history.
- **Quality gate (opt-in)**: Gemini pre-check image quality before fal.ai call.

Current status: ✅ **Implemented**

Completed:
- ✅ Result download endpoint
- ✅ Delete-all history endpoint
- ✅ Explicit cacheKey & expiresAt in response
- ✅ Quality gate (TRYON_QUALITY_GATE_ENABLED, fail-open)
- ✅ Mock provider for local testing
- ✅ Duplicate request lock (Redis)

### FR-05 Quota And Rate Limiting

Required:

- Quota by tier (FREE/MEMBER/VIP) and action (TRY_ON/STYLIST/CHATBOT).
- Global rate limit (configurable window/max).
- Stricter auth endpoint rate limit.
- Cache hits do not consume quota.
- Return quota details: used, remaining, limit, resetAt (next midnight).
- Per-action quota config in constants.

Current status: ✅ **Implemented**

Completed:
- ✅ Reset at exact next midnight (not 24h TTL)
- ✅ Redis counter with in-memory fallback
- ✅ DB persistence via daily_usages table
- ✅ QuotaGuard + @AiAction decorator

Quota table:
| Action | FREE | MEMBER | VIP |
|--------|------|--------|-----|
| TRY_ON | 3 | 10 | ∞ |
| STYLIST | 3 | 20 | ∞ |
| CHATBOT | 50 | 200 | ∞ |

### FR-06 AI Stylist

Required:

- Analyze user image using Gemini Vision (gemini-2.0-flash).
- Optional product context via `productId`.
- Optional garment description.
- Use body measurements when available.
- Occasion, style preference, budget, gender preference.
- Parse & validate JSON output with schema.
- **Repair prompt**: re-prompt with error context on JSON parse failure.
- Save history with rawProviderResponse.

Current status: ✅ **Implemented**

Completed:
- ✅ Repair prompt on malformed JSON
- ✅ Schema validation with detailed errors
- ✅ Quota: 3/day FREE, 20/day MEMBER
- ✅ History: list/detail/delete/delete-all
- ✅ Product compatibility score (0-100)

### FR-07 Try-On History

Required:

- List user's try-on results (paginated).
- View one result.
- Delete one result.
- **Delete all results**.
- **Download image** endpoint.
- Reopen old result without consuming quota.

Current status: ✅ **Implemented**

Completed:
- ✅ Delete all results
- ✅ Download image endpoint

### FR-08 Payments And Tier Upgrade

Required:

- Create checkout for tier upgrade (MEMBER/VIP).
- Create checkout for product orders (COD/SePay).
- Receive SePay IPN (HMAC verified) & Webhook.
- Mark order as paid.
- Upgrade user tier on subscription success.
- Stock decrement on COD CONFIRMED / online PAID.
- Stock restock on CANCELLED/RETURNED.
- Expose user order history (list/detail).
- Cancel pending order (user).
- Admin: list all orders, update status with transitions.

Current status: ✅ **Implemented**

Completed:
- ✅ SePay IPN HMAC signature verification
- ✅ SePay Webhook HMAC verification
- ✅ Production vs mock behavior separated
- ✅ Product order flow: Order + OrderItem + stock management
- ✅ COD support (stock decrement at CONFIRMED)
- ✅ Order status transitions with validation
- ✅ Email notifications on CONFIRMED/CANCELLED

### FR-09 Chatbot (NEW)

Required:

- Streaming chat via SSE (`POST /api/chat`).
- Groq models: openai/gpt-oss-120b (default), qwen/qwen3.6-27b, openai/gpt-oss-20b.
- Session management: create/list/get/delete sessions.
- Context: conversation history + user measurements + product context.
- Quota enforcement via QuotaGuard (CHATBOT action).
- System prompt: FashionAI Assistant (office wear, smart casual, Vietnamese).

Current status: ✅ **Implemented**

Completed:
- ✅ SSE streaming with token/done/error events
- ✅ Session CRUD + message history
- ✅ Quota: 50/day FREE, 200/day MEMBER, ∞ VIP
- ✅ Context injection (measurements, productId)
- ✅ Error handling in stream (yields error event)

### FR-10 3D Avatar / Mannequin (NEW)

Required:

- Generate 3D avatar from measurements via Blender + MPFB2.
- Sync pipeline (~2s), cache by measurement hash.
- Preset grid: gender × height × weight → pre-generated GLB.
- Morph target deltas for FE to adjust to user measurements.
- Endpoints:
  - `POST /api/avatar/generate` — generate or return cached
  - `GET /api/avatar/me` — latest avatar
  - `GET /api/avatar/:id` — by ID
  - `GET /api/avatar/presets?gender=` — list presets
  - `GET /api/avatar/presets/nearest` — nearest preset + morph deltas
  - `GET /api/avatar/:name/file` — stream GLB (local fallback)
- GLB stored on Cloudinary (raw) or local storage fallback.

Current status: ✅ **Implemented (Backend)**

Completed:
- ✅ Blender + MPFB2 pipeline (calibration.json embedded)
- ✅ Cache by measurement hash (unique userId+cacheKey)
- ✅ Preset generation script (`npm run presets:generate`)
- ✅ Morph target deltas + factors for FE
- ✅ Cloudinary raw upload + local fallback streaming
- ✅ E2E tests with mocked Blender

### FR-11 Transactional Email (NEW)

Required:

- Email verification.
- Password reset.
- Order confirmation (items, totals, shipping info).
- Order status update (CONFIRMED/CANCELLED).
- Brevo (Sendinblue) Transactional Email API.

Current status: ✅ **Implemented**

Completed:
- ✅ Brevo SDK integration (replaces nodemailer)
- ✅ Template HTML for all email types
- ✅ Sender parsing from MAIL_FROM
- ✅ Dev mode fallback (logs to console)

---

## 4. Non-Functional Requirements

### Performance

- Non-AI API < 200ms under normal DB load.
- Try-On timeout configurable (`TIMEOUT_MS`, default 120s).
- Cache hit avoids external AI call.
- Chatbot streaming: first token < 2s.

### Security

- JWT for protected endpoints (HS256).
- Refresh token: HttpOnly, Secure (prod), SameSite=Lax, path=/api.
- Access token rotation + blacklist.
- CORS: locked to FRONTEND_URL in production (never `*`).
- OAuth state/CSRF verified.
- File upload: MIME + size validation (10MB).
- Payment webhooks: HMAC verified in production.
- Rate limits: global + strict auth endpoints.

### Reliability

- SAM2 failure → fallback to original garment image.
- AI provider timeout → controlled error (408/503).
- Redis fallback → in-memory for local dev.
- Chatbot streaming: graceful error event on failure.
- Blender pipeline: timeout (60s), lock, cleanup.

### Observability

- Request ID middleware.
- Structured logs (NestJS Logger).
- Health checks: DB ✅, Redis ✅ (via HealthController).
- AI provider health & cost monitoring: ❌ planned.

---

## 5. Data Model Summary

Implemented Prisma models:

- `User` (+ tier, role, avatarUrl, provider)
- `Measurement` (15 fields, nullable)
- `RefreshToken` (hashed, expiresAt)
- `PasswordResetToken` (hashed, expiresAt)
- `EmailVerificationToken` (hashed, expiresAt)
- `Product` (+ images[], colors[], sizes[], brand, stock, status)
- `ProductImage` (isMain, imageUrl)
- `TryOnResult` (cacheKey, expiresAt, human/garment hashes)
- `StylistResult` (analysisResult JSON, inputContext, rawProviderResponse)
- `ChatSession` + `ChatMessage` (role, content, tokensIn/Out)
- `Avatar` (cacheKey, glbUrl, measurements)
- `AvatarPreset` (gender, height, weight, glbUrl, presetMeasurements)
- `Order` (+ targetTier, amount, status, shippingInfo, shippingFee, discount)
- `OrderItem` (productId, quantity, size, color, price)
- `Payment` (provider, transactionId, paymentData)
- `DailyUsage` (userId, action, date, count — unique index)

---

## 6. API Summary

### Auth
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `POST /api/auth/logout-all`
- `POST /api/auth/change-password`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `POST /api/auth/verify-email`
- `POST /api/auth/resend-verification`
- `GET /api/auth/google`
- `GET /api/auth/google/callback`

### Users
- `GET /api/users/me`
- `PUT /api/users/me`
- `GET /api/users/me/measurements`
- `PUT /api/users/me/measurements`
- `GET /api/users/me/quota?action=`
- `GET /api/users` (admin, paginated)
- `PATCH /api/users/:id` (admin)

### Products
- `GET /api/products` (public, filter, search, paginated)
- `GET /api/products/:id`
- `POST /api/products` (admin, multipart)
- `PUT /api/products/:id` (admin, multipart)
- `DELETE /api/products/:id` (admin)

### Try-On
- `POST /api/try-on` (multipart: humanImage, garmentImage?, productId?, garmentCategory?)
- `GET /api/try-on/history` (paginated)
- `GET /api/try-on/history/:id`
- `GET /api/try-on/history/:id/download` (stream)
- `DELETE /api/try-on/history/:id`
- `DELETE /api/try-on/history/all`

### Stylist
- `POST /api/stylist/analyze` (multipart: humanImage, productId?, garmentDescription?, occasion?, stylePreference?, budget?, genderPreference?)
- `GET /api/stylist/history` (paginated)
- `GET /api/stylist/history/:id`
- `DELETE /api/stylist/history/:id`
- `DELETE /api/stylist/history/all`

### Chatbot
- `POST /api/chat` (SSE stream, body: {message, sessionId?, productId?, context?})
- `GET /api/chat/sessions` (paginated)
- `GET /api/chat/sessions/:id` (with messages)
- `DELETE /api/chat/sessions/:id`

### Avatar (3D)
- `POST /api/avatar/generate` (gender, height, weight, chest, waist, hip, shoulder, draco?, morph?)
- `GET /api/avatar/me`
- `GET /api/avatar/:id`
- `GET /api/avatar/presets?gender=`
- `GET /api/avatar/presets/nearest?gender=&height=&weight=&chest=&waist=&hip=&shoulder=`
- `GET /api/avatar/:name/file` (stream GLB)

### Payments
- `POST /api/payments/checkout` (targetTier?, orderId?, provider=SEPAY)
- `POST /api/payments/sepay-ipn` (SePay IPN, HMAC verified)
- `POST /api/payments/sepay-webhook` (SePay Webhook, HMAC verified)
- `GET /api/payments/orders` (user)
- `GET /api/payments/mock-success?orderCode=` (dev only)

### Health
- `GET /api/health` (DB + Redis)

---

## 7. Configuration (.env)

Key variables:

```env
# App
NODE_ENV=development
PORT=3001
API_PREFIX=api
FRONTEND_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:3000

# Database
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...

# Auth
JWT_ACCESS_SECRET=...
JWT_REFRESH_SECRET=...
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d

# AI Providers
AI_TRYON_PROVIDER=mock|fal
FAL_KEY=...
FASHN_MODEL=fal-ai/fashn/tryon/v1.6
SAM2_ENABLED=true
SAM2_MODEL=fal-ai/sam2/auto-segment
GEMINI_API_KEY=...
GROQ_API_KEY=...
GROQ_MODEL=openai/gpt-oss-120b
GROQ_TEMPERATURE=0.7
GROQ_MAX_TOKENS=2048
TRYON_QUALITY_GATE_ENABLED=false

# Mail (Brevo)
BREVO_API_KEY=...
MAIL_FROM="FashionAI <noreply@yourdomain.com>"

# Payment (SePay)
SEPAY_MERCHANT_ID=...
SEPAY_SECRET_KEY=...
SEPAY_IPN_SECRET=...
SEPAY_WEBHOOK_SECRET=...
SEPAY_CHECKOUT_URL=https://pay-sandbox.sepay.vn/v1/checkout/init
SEPAY_SUCCESS_URL=...

# Storage
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...

# Redis
REDIS_URL=redis://localhost:6379

# Blender Avatar (optional)
BLENDER_PATH=
AVATAR_STORAGE_DIR=storage/avatars
AVATAR_PUBLIC_BASE_URL=http://localhost:3001/api/avatar
```

---

## 8. Implementation Status (2026-08-22)

| Feature | Status | Notes |
|---------|--------|-------|
| Auth & Account | ✅ Complete | Token cleanup cron, OAuth CSRF |
| Body Measurements (15 fields) | ✅ Complete | FE aliases supported |
| Product Catalog + Admin Upload | ✅ Complete | Cloudinary, status, rich fields |
| Virtual Try-On | ✅ Complete | Cache, quality gate, download, delete-all |
| AI Stylist | ✅ Complete | Repair prompt, 3/day quota, delete-all |
| **Chatbot (Groq, SSE)** | ✅ Complete | Sessions, context, quota |
| **3D Avatar (Blender+MPFB2)** | ✅ Backend Complete | Presets, morph, GLB streaming |
| **Mail (Brevo)** | ✅ Complete | All templates, dev fallback |
| Payments (SePay) | ✅ Complete | IPN/Webhook HMAC, COD, stock |
| Quota & Rate Limit | ✅ Complete | Midnight reset, Redis fallback |
| Health Checks | ✅ Partial | DB + Redis |
| Observability | ⚠️ Partial | Request ID, logs; no cost monitoring |
| CI/CD & E2E | ❌ Missing | GitHub Actions, full E2E suite |

---

## 9. Remaining Technical Debt

1. **72 lint warnings** — explicit `any` types
2. **No CI/CD pipeline** — GitHub Actions needed
3. **E2E tests** — payments-webhook needs valid HMAC in tests
4. **Observability** — Redis/AI provider health, cost monitoring
5. **Swagger descriptions** — Vietnamese encoding review
6. **Admin quota config UI/API** — not yet implemented

---

## 10. Priority Backlog

1. Add CI/CD (build, lint, unit test, e2e)
2. Fix E2E payments-webhook test (mock valid HMAC)
3. Add Redis/AI provider health endpoints
4. Add AI cost tracking middleware
5. Review all Swagger @ApiProperty descriptions for encoding
7. Consider admin quota configuration endpoints
