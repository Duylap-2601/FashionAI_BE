# FashionAI Backend Agent Guide

This repo is a NestJS 10 backend for FashionAI. Follow the existing module-first
structure and keep changes scoped to the feature that owns the behavior.

## Stack And Commands

- Runtime: NestJS, TypeScript, Prisma Client, PostgreSQL.
- Validation: class-validator/class-transformer DTO classes with Nest's global
  `ValidationPipe`.
- API docs: Swagger decorators from `@nestjs/swagger`.
- Realtime: Socket.IO through `modules/realtime` and the Redis adapter in
  `common/redis`.
- Storage and providers: Cloudinary, SePay, fal.ai FASHN, Gemini/OpenAI style AI
  services, Redis, BullMQ queues, mail providers.

Use these repo scripts:

- `npm run start:dev` for local development.
- `npm run build` for production compilation.
- `npm run lint:check` to check lint without rewriting files.
- `npm run lint` to run ESLint with auto-fix when the change warrants it.
- `npm run format` for Prettier on `src/**/*.ts` and `test/**/*.ts`.
- `npm run test:unit` for unit tests.
- `npm run test:e2e` for e2e tests.
- `npm run prisma:generate`, `npm run prisma:migrate`, and
  `npm run migrate:deploy` for Prisma work.

Do not invent scripts that are not in `package.json`. If you need a type-only
check, use the local TypeScript toolchain explicitly and state that it is not a
repo script.

## Current Folder Shape

Keep source code under `src`:

- `app.module.ts`, `main.ts`: application composition and global bootstrap only.
- `database/`: `PrismaModule` and `PrismaService`.
- `common/`: shared code that is genuinely reusable across modules.
- `common/constants/`: domain constants shared by multiple modules.
- `common/decorators/`, `common/guards/`, `common/filters/`,
  `common/middleware/`, `common/pipes/`: framework-level Nest building blocks.
- `common/redis/` and `common/services/`: shared infrastructure services.
- `common/utils/`: small pure helpers such as response, CORS, config, and order
  code helpers.
- `modules/<feature>/`: one folder per business feature.
- `test/unit` and `test/e2e`: tests matching the existing Jest configs.
- `prisma/schema.prisma` and `prisma/migrations`: database schema and migrations.

Use relative imports, matching the current codebase. There is no `@/` path alias
configured in `tsconfig.json`.

## Feature Module Boundaries

Each feature folder should own its public HTTP surface, business rules, and DTOs:

- `<feature>.module.ts` wires providers, controllers, imports, and exports.
- `<feature>.controller.ts` handles routing, guards, Swagger metadata, request
  extraction, and `buildApiResponse`.
- `<feature>.service.ts` owns business rules, Prisma transactions, provider
  orchestration, and returned data shape.
- `dto/*.dto.ts` contains request DTOs and validation decorators.
- `constants/*.ts`, `types/*.ts`, `utils/*.ts`, or `services/*.ts` may be added
  inside the feature only when they serve that feature directly.

Small modules can stay flat with just module/controller/service/dto files. Add
subfolders only after a module has multiple concrete responsibilities.

Existing ownership boundaries:

- `auth`: login/register/OAuth/password flows, token issuing, auth guards,
  strategies, and auth-only Redis helpers.
- `users`: profile and body measurements. User measurement input belongs here;
  order measurement snapshots belong to `orders`.
- `products`: product catalog, product images, reviews, and review replies.
- `orders`: product order lifecycle, order status transitions, measurement
  review for made-to-measure orders, order history, shipment linkage, refunds,
  stock changes, and customer-visible order tracking.
- `payments`: checkout links, SePay webhooks/IPN handling, payment records, and
  subscription activation.
- `shipping`: shipping fee/address/provider lookup and shipping-provider API
  integration. Persisted shipment state that changes an order still needs to
  coordinate with `orders`.
- `notification`: notification persistence and user notification APIs.
- `realtime`: Socket.IO gateway/auth/emitter plumbing. Business modules should
  emit through exported services instead of depending directly on gateways.
- `try-on`, `stylist`, `chat`: AI workflows and prompt/provider orchestration.
- `storage`, `mail`, `health`, `admin`, `maintenance`, `rack`, `collections`:
  keep their current domain responsibilities.

Mail delivery is owned by `modules/mail`. Business modules should enqueue mail
through `MailQueueService`; only the mail processor should call `MailService`
directly to send through the provider. BullMQ uses the same Redis connection
environment variables as the rest of the app (`REDIS_URL` or host/port/password).

Avoid moving behavior into `common` just because two files can import it. Put code
in `common` only when it is stable, domain-neutral, and already useful to multiple
modules.

## Splitting Large Files

Do not split files by arbitrary line count alone. Split when a file has separate
workflows, separate dependency needs, or separate tests that can be understood on
their own.

Good split candidates in this repo:

- `orders.service.ts`: extract focused providers such as order creation,
  lifecycle/status transition, measurement review, shipment coordination,
  refunds, event/history, and public order mapping when those areas keep growing.
- `payments.service.ts`: separate checkout creation, SePay signing/verification,
  webhook/IPN parsing, payment success processing, subscription-payment handling,
  and payment response mapping.
- `products/reviews.service.ts`: separate review CRUD, review replies, rating
  aggregation, and review notifications if more review behavior is added.
- AI services (`try-on`, `stylist`, `chat`): keep provider SDK calls, cache/key
  generation, prompt building, quota accounting, and response mapping in focused
  helpers when the service becomes difficult to scan.
- Large controllers: split only by clear route ownership, such as products vs
  reviews. Keep route handlers thin.

When extracting from a service:

- Keep the public controller contract stable unless the task explicitly changes
  the API.
- Preserve Prisma transaction boundaries. If helper services participate in a
  transaction, pass `Prisma.TransactionClient` into them instead of opening a new
  transaction inside each helper.
- Keep domain constants near the feature unless more than one module uses them.
- Keep DTOs grouped by endpoint or workflow, not in one oversized DTO file.
- Prefer pure mapper/helper functions for response shaping when they do not need
  DI. Use injectable services only when dependencies, configuration, logging, or
  test seams justify DI.
- Export only the providers another module must inject. Do not export a whole
  module's internals by default.
- Do not add `forwardRef()` to hide a circular dependency. Rework ownership or
  introduce a small one-way adapter such as the current `RealtimeEmitter`.

Avoid these patterns:

- One-method services created only to reduce line count.
- Generic `repository`, `manager`, `helper`, or `utils` files with unrelated
  behavior.
- New barrel files unless the module already uses that style.
- Bulk folder renames that force unrelated import churn.
- Copying DTOs between modules instead of moving the shared concept to the
  correct owner.

## Database And Prisma

Use the existing Prisma schema as the source of truth before designing new tables
or fields. Prefer extending current models when they already represent the
domain:

- Orders: `Order`, `OrderItem`, `OrderEvent`, `Payment`, `Shipment`.
- Users and sizing: `User`, `Measurement`.
- Products and merchandising: `Product`, `ProductImage`, `Collection`,
  `ProductCollection`, `RackItem`, `Review`, `ReviewReply`.
- Subscription and AI usage: `Subscription`, `DailyUsage`, `TryOnResult`,
  `StylistResult`, `ChatSession`, `ChatMessage`.
- Notifications: `Notification`.

When schema changes are required:

- Update `prisma/schema.prisma` and add a migration under `prisma/migrations`.
- Run or request `npm run prisma:generate` after schema changes when Prisma types
  are needed for implementation.
- Keep existing `@@map` and `@map` naming conventions.
- Add indexes for lookup patterns that new endpoints actually use.
- Do not create database migrations for TypeScript-only file movement.

## API And Response Conventions

- Keep controllers thin. They should apply guards/decorators, read params/query
  and body DTOs, call services, and wrap responses with `buildApiResponse`.
- Public endpoints use `@Public()` only when authentication is intentionally not
  required. Most feature controllers currently use `JwtAuthGuard`.
- Admin-only routes should combine `JwtAuthGuard`, `RolesGuard`, and
  `@Roles(Role.ADMIN)`.
- Preserve the current response envelope:
  `{ success, code, message, timestamp, path, data, meta? }`.
- For order tracking, customer endpoints must return enough state for the client
  to follow progress: current order status, payment status, shipment summary, and
  public order history/events where applicable.
- Keep backward-compatible input handling when existing clients depend on it,
  such as order lookup by UUID or `ORD-<orderCode>` and shipping note/notes
  compatibility.

## Testing And Validation

Match tests to risk:

- Unit tests live in `test/unit` unless they are colocated beside an existing
  provider spec.
- E2E tests live in `test/e2e` and should use existing helpers from
  `test/e2e/helpers` when possible.
- For service extraction with no behavior change, run lint/build or focused unit
  tests if available.
- For API behavior changes, add or update e2e tests covering the user-visible
  contract.
- For payment, stock, status transition, refund, or shipment changes, test
  idempotency and invalid-state paths, not only the happy path.

## Working Rules

- Preserve user changes in the working tree. Read files before editing them and
  keep patches scoped to the requested task.
- Do not run destructive git commands unless the user explicitly asks.
- Do not reformat unrelated files.
- Do not log secrets or print `.env` content.
- Keep comments useful and short. Existing Vietnamese comments are fine; use
  English or Vietnamese consistently with nearby code.
- If a feature needs new folders, create only the folders that will contain real
  files in the same change.
