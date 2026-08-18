# FashionAI Backend - Source Review & Implementation Plan

Updated: 2026-08-17

## 1. Current Status

Backend is a NestJS 10 API using Prisma/PostgreSQL, Redis/ioredis, fal.ai, Google Gemini, Cloudinary-compatible storage, and payment integrations. The implementation is ahead of the older SRS checklist in several areas: product catalog, try-on history/cache, stylist history, token reset/verification, quota tracking, and payment-based tier upgrades already exist in source.

Recent verification:

- `npm.cmd run build`: passed.
- `npm.cmd run test:unit -- --runInBand --detectOpenHandles`: passed.
- Unit tests: 4 suites, 28 tests passed.

## 2. Implemented

### Foundation

- NestJS module structure under `src/modules`.
- Prisma schema and migrations for core backend data.
- Global validation pipe.
- Global exception filter.
- Swagger/OpenAPI at `/api/docs`.
- Config-driven CORS.
- Cookie parser for refresh token cookie.
- Request ID middleware.
- Global rate limit guard.
- Dockerfile and docker-compose.
- Database health check.

### Auth & Account

- Email/password register and login.
- JWT access token.
- Refresh token rotation and storage.
- Refresh token cookie support.
- Logout current session.
- Logout all sessions.
- Access-token blacklist support.
- Change password.
- Forgot password and reset password.
- Email verification and resend verification.
- Google OAuth redirect/callback.
- Expired token cleanup endpoint guarded by maintenance secret in production.

### Users & Measurements

- `GET /users/me`.
- `PUT /users/me`.
- `GET /users/me/measurements`.
- `PUT /users/me/measurements`.
- `GET /users/me/quota`.
- Measurement validation exists in DTOs.

### Products

- Product and product image Prisma models.
- Public product list/detail endpoints.
- Search, filter, price range, pagination.
- Admin-only create/update/delete with `JwtAuthGuard` and `RolesGuard`.

### Virtual Try-On

- `POST /try-on` is protected by JWT and quota.
- Supports uploaded `humanImage`.
- Supports either uploaded `garmentImage` or catalog `productId`.
- Supports category mapping: `UPPER`, `LOWER`, `FULL_BODY`.
- Uploads input to fal.storage.
- Optional SAM2 preprocessing controlled by `SAM2_ENABLED`.
- FASHN model configurable by env.
- Timeout wrapper around provider calls.
- Saves generated result to storage.
- Persists try-on history in DB.
- Cache hit by image hashes and category.
- Duplicate active request lock.
- Cache hit does not consume quota.
- History list/detail/delete endpoints.
- Mock provider mode for local/frontend testing.

### AI Stylist

- `POST /stylist/analyze` is protected by JWT and quota.
- Upload validation for human image.
- Gemini model configurable by env.
- Can use either product context or garment description.
- Loads user measurements when available.
- Parses and validates JSON response.
- Retries Gemini calls.
- Persists analysis history.
- History list/detail/delete endpoints.

### Quota & Rate Limiting

- Per-action quotas for `TRY_ON`, `STYLIST`, and `CHATBOT`.
- Tier-aware limits: `FREE`, `MEMBER`, `VIP`.
- Redis-backed counters with in-memory fallback.
- DB persistence via `daily_usages`.
- Global rate limiting.
- Stricter auth endpoint rate limit.

### Payments & Tier Upgrade

- Checkout endpoint for tier upgrade.
- PayOS checkout link support.
- MoMo sandbox checkout link support.
- Webhook/IPN handlers.
- Mock success endpoint disabled in production.
- Paid order upgrades user tier.
- User order history endpoint.

## 3. Gaps Against SRS

### Documentation & Consistency

- `README.md`, `GETTING_STARTED.md`, `SRS.md`, and several Swagger descriptions contain mojibake/broken Vietnamese encoding.
- The older review plan was stale and understated implemented functionality.
- Some docs still imply older Gradio/Kolors history while source uses fal.ai/FASHN.
- Response shape is not fully consistent: most feature modules return `{ success, code, message, data }`, while `users` returns raw objects.

### Auth & Security

- Google OAuth exists, but production OAuth state/CSRF behavior should be verified end to end.
- Maintenance endpoint is public-route plus header secret in production; acceptable for internal use but should be documented.
- MoMo IPN currently processes success without signature verification.
- PayOS webhook verification depends on PayOS config; mock/fallback behavior should be explicitly separated from production.
- No automated scheduled cleanup job for expired tokens; only manual cleanup endpoint exists.

### Try-On

- No mannequin/3D try-on path yet.
- No dedicated download endpoint for result image.
- No delete-all-history endpoint.
- Cache has no explicit `cacheKey` or `expiresAt` as described in SRS.
- Cache lookup is global by image hash/category, not scoped by product or expiry policy.
- Quota reset TTL is a fixed 86400 seconds rather than exact next midnight.
- No pre-compute mannequin strategy for Guest/Free users.
- No Gemini image-quality gate before fal.ai cost is incurred.

### Products/Admin

- No multipart admin product-image upload endpoint.
- Product model is simpler than SRS: no brand, stock, JSON size chart, multi-color JSON, or active flag separate from status.
- No admin usage statistics or quota configuration UI/API.

### Orders

- Current `Order` model supports subscription/tier upgrade, not full product purchase flow.
- Missing `order_items`, shipping information, product quantities, cancel endpoint, and full order detail endpoints from SRS.

### AI Stylist

- SRS says Free users get 3 stylist uses/day, but code/tests indicate 5/day.
- No explicit Gemini response repair prompt after invalid JSON; current retry repeats the provider call.
- No dedicated product recommendation engine beyond prompt-driven Gemini output.

### Health, Observability, Production

- Health check only verifies database.
- Redis and AI provider health checks are missing.
- Structured logging and cost monitoring are not implemented.
- CI/CD is not present.
- E2E test config is referenced but no e2e test file/config was found in the current file list.

### 3D Mannequin

- `AvatarService`/`AvatarModule` does not exist.
- No Blender headless pipeline.
- No MPFB2 morph target mapping.
- No GLB generation/storage endpoint.
- No server-side mannequin render/capture workflow.

## 4. Next Implementation Order

### Step 1 - Documentation Cleanup

- [x] Refresh this review plan to match current source.
- [x] Rewrite `README.md` with valid Vietnamese text and current endpoints.
- [x] Rewrite `GETTING_STARTED.md` with valid Vietnamese text and current env values.
- [x] Remove real-looking secrets from `.env.example`.
- [x] Rewrite `SRS.md` as a clean current draft.

### Step 2 - Response Contract

- [ ] Add a shared response helper/interceptor or DTO convention.
- [x] Wrap Users endpoints consistently.
- [ ] Keep binary/streaming responses explicit if added later.
- [ ] Ensure validation errors keep the same error envelope.

### Step 3 - Quota, Rate Limit, Health, Security Hardening

- [x] Change quota TTL to expire at the next local midnight.
- [x] Align Stylist Free quota with SRS.
- [x] Add Redis health indicator.
- [x] Add MoMo IPN signature verification.
- [ ] Document production payment modes and disable fallback behavior in production.
- [ ] Add provider-cost safe guards where practical.

### Step 4 - Product/Admin Completeness

- [x] Add multipart image upload for admin products.
- [x] Store product images through storage service.
- [ ] Add missing product fields if the frontend needs them: brand, stock, sizes/colors arrays, size chart.
- [ ] Add admin usage/quota statistics endpoint.

### Step 5 - Orders

- [ ] Decide whether orders are for product purchases, subscriptions, or both.
- [x] Add `OrderItem` and shipping info.
- [x] Add list/detail/cancel endpoints matching SRS.
- [ ] Keep tier upgrade payment flow idempotent.

### Step 6 - Try-On Completion

- [ ] Add explicit `cacheKey` and `expiresAt`.
- [ ] Add result download endpoint.
- [ ] Add delete-all history endpoint.
- [ ] Add optional Gemini image-quality validation before fal.ai.
- [ ] Add precomputed mannequin/free-user strategy if required by cost targets.

### Step 7 - AI Stylist Completion

- [ ] Add repair prompt when Gemini returns invalid JSON.
- [ ] Add stronger schema validation.
- [ ] Add more tests for quota consumption and history.

### Step 8 - 3D Mannequin

- [ ] Add `AvatarModule`.
- [ ] Add avatar generation API.
- [ ] Implement Blender headless execution.
- [ ] Add MPFB2 mapping script.
- [ ] Store generated GLB.
- [ ] Integrate mannequin output with try-on input.

### Step 9 - Tests & CI

- [ ] Add e2e test config or remove broken script reference.
- [ ] Add auth e2e tests.
- [ ] Add product admin e2e tests.
- [ ] Add try-on mock-provider e2e tests.
- [ ] Add CI build/lint/unit test pipeline.

## 5. MVP Priority

For the next practical MVP pass:

1. Finish documentation cleanup and remove placeholder/security confusion.
2. Standardize response shape.
3. Harden quota reset, health checks, and payment webhook security.
4. Add admin product image upload.
5. Add product-order flow only if the frontend needs real checkout for clothing purchases.
6. Leave 3D mannequin for a later dedicated phase.
