# Plan: BE trên Render kết nối private PostgreSQL qua Tailscale

Ngày: 2026-10-02. Trạng thái: kế hoạch, chưa triển khai.

## Mục tiêu và thông tin đã xác nhận

- Repo: `FashionAI_BE`, NestJS 10 + Prisma 5 + PostgreSQL.
- Deploy trên Render bằng một Docker container.
- DB đích: `100.90.252.117:30432`.
- Database và user: `lamtailoi`.
- Người dùng hiện phải bật Tailscale mới truy cập được DB.
- Người dùng đăng nhập Tailscale qua Google; container sẽ dùng auth key.
- Mật khẩu DB và auth key chỉ cấu hình qua secrets trên Render.

## Kiến trúc

```text
Client -> Render HTTPS -> NestJS (0.0.0.0:$PORT)
                            |
                          Prisma
                            |
                   TCP 127.0.0.1:15432
                            |
                     socat TCP listener
                            |
                 tailscale nc (mỗi kết nối)
                            |
                tailscaled userspace networking
                            |
                   100.90.252.117:30432
```

Chạy Tailscale với `--tun=userspace-networking`, không phụ thuộc thiết bị TUN
hoặc quyền NET_ADMIN. Proxy TCP dùng `socat` với listener chỉ bind loopback,
fork mỗi kết nối và chuyển dữ liệu qua `tailscale nc` tới DB. Prisma tiếp tục
dùng PostgreSQL TCP thông thường; không dựa vào HTTP_PROXY để chuyển traffic DB.

Địa chỉ đích đã đủ để triển khai đường kết nối. Chưa xác định máy Tailscale đích
chạy PostgreSQL trực tiếp hay chuyển tiếp tới DB khác; cần kiểm tra port thực tế
trước khi chạy migration. Không mặc định cần subnet router cho địa chỉ đã cung cấp.

## Hiện trạng repo

- `Dockerfile` đã có builder/runner, Node 22 Alpine, Prisma generate, OpenSSL,
  tini và user `node`.
- `docker-entrypoint.sh` chạy migration rồi `node dist/main.js`.
- Entrypoint hiện tự gọi `prisma migrate resolve --rolled-back` cho một migration
  cụ thể và retry migration; cần thay cơ chế này trong phần triển khai.
- `prisma/schema.prisma` dùng cả `DATABASE_URL` và `DIRECT_URL`.
- `src/main.ts` đã listen trên `0.0.0.0` và đọc `PORT`.
- Có `/api/health/liveness` và `/api/health`; endpoint thứ hai kiểm tra DB.
- Compose hiện phục vụ app + PostgreSQL + Redis local.

## Các thay đổi dự kiến

### 1. Docker image

- [ ] Giữ cấu trúc build nhiều stage và runtime không chạy bằng root.
- [ ] Copy `tailscale` và `tailscaled` từ image chính thức, pin phiên bản/digest
  đã kiểm chứng tương thích với kiến trúc image trên Render.
- [ ] Cài `socat` và supervisor để quản lý các process trong cùng container.
- [ ] Tạo thư mục socket/state tạm có quyền ghi cho user `node`.
- [ ] Giữ tini để thu hồi process con; supervisor chịu trách nhiệm quản lý vòng đời.
- [ ] Không đưa auth key, mật khẩu hoặc state Tailscale vào image/layer build.

### 2. Bootstrap và vòng đời

- [ ] Thêm script bootstrap Tailscale và wrapper proxy dưới `docker/`.
- [ ] Validate biến cấu hình, host và port trước khi chạy; truyền đối số an toàn,
  không dùng `eval` hoặc ghép secrets vào shell command.
- [ ] Start `tailscaled` userspace với socket riêng và state tạm cho ephemeral node.
- [ ] Đăng nhập bằng auth key, chờ trạng thái sẵn sàng với timeout hữu hạn.
- [ ] Start listener `127.0.0.1:15432`; wrapper gọi `tailscale nc` qua đúng socket.
- [ ] Chạy truy vấn `SELECT 1` bằng Prisma qua proxy, có deadline và retry giới hạn.
  Port local mở hoặc Tailscale ping thành công chưa đủ chứng minh DB hoạt động.
- [ ] Chạy `npm run migrate:deploy` sau khi DB sẵn sàng, rồi start NestJS.
- [ ] Bỏ tự động `migrate resolve --rolled-back`: lỗi migration thực sự phải dừng
  startup, giữ log đã che secrets để xử lý theo trạng thái DB.
- [ ] Supervisor dừng cả container nếu daemon, listener hoặc app thoát bất thường;
  lỗi riêng một kết nối DB không được làm chết listener.
- [ ] Khi SIGTERM, chuyển signal và dọn NestJS, proxy, các process con và daemon
  trong thời gian shutdown cho phép.
- [ ] Có `TAILSCALE_ENABLED=false` để giữ đường chạy DB trực tiếp/local hiện có;
  khi bật thì thiếu cấu hình phải fail, không tự fallback sang DB khác.

### 3. Cấu hình môi trường

Các tên biến dưới đây là giao diện dự kiến của bootstrap; script phải đọc và
chuyển chúng thành tham số CLI, không giả định binary tự đọc mọi biến môi trường.

```dotenv
TAILSCALE_ENABLED=true
TS_AUTHKEY=<secret-tren-render>
TAILSCALE_DB_HOST=100.90.252.117
TAILSCALE_DB_PORT=30432
DB_PROXY_PORT=15432
TAILSCALE_STARTUP_TIMEOUT_SECONDS=60
DB_CONNECT_TIMEOUT_SECONDS=60

DATABASE_URL=postgresql://lamtailoi:<URL_ENCODED_PASSWORD>@127.0.0.1:15432/lamtailoi
DIRECT_URL=postgresql://lamtailoi:<URL_ENCODED_PASSWORD>@127.0.0.1:15432/lamtailoi
```

- [ ] Bổ sung placeholders và giải thích vào `.env.example`.
- [ ] Xác nhận port `30432` là PostgreSQL direct hay pooler. Hai URL chỉ dùng chung
  proxy khi endpoint hỗ trợ cả runtime và Prisma migration; nếu có endpoint direct
  riêng, thêm listener và upstream riêng cho `DIRECT_URL`.
- [ ] Xác nhận yêu cầu TLS và các tham số URL gốc. Không tự thêm `sslmode=disable`.
  Nếu xác thực chứng chỉ theo hostname, thiết kế lại cách giữ hostname đích/CA
  tương thích Prisma 5 trước khi dùng URL localhost; không tắt verify để chữa lỗi.
- [ ] Giữ Redis và các secrets ứng dụng đang có trong cấu hình Render.

### 4. Auth key và quyền truy cập

- [ ] Tạo auth key ở đúng tailnet có quyền truy cập DB, dùng tài khoản Google
  đăng nhập trang Settings > Keys.
- [ ] Dùng key reusable + ephemeral cho container được tạo lại; bật pre-approved
  nếu tailnet bật device approval và người cấu hình có quyền.
- [ ] Thiết lập danh tính/tag dành cho BE và policy cho phép tới đúng DB port
  `100.90.252.117:30432`; kiểm tra quyền thực tế của node container.
- [ ] Lưu `TS_AUTHKEY` vào Render Environment; không dùng mật khẩu Google hoặc API key.
- [ ] Ghi ngày hết hạn và cách thay auth key trước lần container đăng ký mới.
  Reusable không có nghĩa key không hết hạn.
- [ ] Nếu tài khoản không có quyền tạo key/policy, nhờ admin tailnet cung cấp.

### 5. Tài liệu và Render

- [ ] Cập nhật README về biến môi trường, tạo key, deploy và xử lý sự cố.
- [ ] Cấu hình Render build từ Dockerfile và dùng entrypoint mặc định của image.
- [ ] Dùng `/api/health` để kiểm tra readiness DB; dùng `/api/health/liveness`
  khi cần phân biệt process còn sống với dependency đang lỗi.
- [ ] Kiểm tra startup deadline thực tế đủ cho Tailscale + DB readiness + migration.
- [ ] Không cấu hình publish port DB/proxy; cổng HTTP app là điểm nhận request.
- [ ] Giữ Compose local dùng DB local với Tailscale tắt.

## Kiểm chứng và tiêu chí hoàn thành

1. Build image thành công; Prisma engine, Tailscale và proxy chạy dưới user `node`.
2. Chạy container với secrets cấp lúc runtime; `SELECT 1` thành công qua tunnel.
3. Kiểm tra runtime URL và direct URL riêng, xác nhận TLS đúng yêu cầu DB.
4. Chạy migration trên DB thử nghiệm trước; không dùng DB production để thử lỗi.
5. NestJS khởi động sau migration; health DB và một API đọc DB hoạt động.
6. Tạo lại container để kiểm tra reusable key và hành vi node ephemeral.
7. Thử key sai/hết hạn, ACL chặn, DB unreachable và migration lỗi: timeout hữu hạn,
   báo đúng giai đoạn lỗi, không giả báo healthy, không in secrets.
8. Kill daemon/listener và gửi SIGTERM: supervisor xử lý đúng, không để process mồ côi.
9. Ngắt rồi khôi phục đường mạng: xác nhận kết nối Prisma phục hồi hoặc readiness
   báo lỗi đúng để nền tảng xử lý.
10. Kiểm tra mode Tailscale tắt vẫn chạy được với DB local và Compose hiện có.
11. Kiểm tra image/log không chứa secrets và listener proxy không truy cập từ ngoài.

## Rollout và rollback

- Build và smoke test trước; deploy thử với DB test và tailnet policy tương ứng.
- Trước migration production, xác nhận backup và tương thích schema với phiên bản
  app cũ; dù cấu hình một instance vẫn có thể có container cũ/mới cùng tồn tại
  trong giai đoạn chuyển deploy.
- Sau deploy, kiểm tra readiness, truy vấn DB và log bootstrap đã che secrets.
- Khi cần rollback, dùng image/cấu hình trước đó còn đường truy cập DB hợp lệ.
  Rollback image không tự rollback migration; không tự chạy migration đảo chiều.

## Thông tin còn cần khi triển khai thật

- Auth key hợp lệ và quyền truy cập DB của node mới trong tailnet.
- Mật khẩu DB, cấu hình TLS/CA và xác nhận endpoint direct/pooler.
- Runtime secrets khác của BE và khả năng truy cập Redis trên Render.

## Tài liệu tham khảo

- [Tailscale userspace networking](https://tailscale.com/docs/concepts/userspace-networking)
- [Tailscale CLI, gồm tailscale nc](https://tailscale.com/docs/reference/tailscale-cli)
- [Tailscale auth keys](https://tailscale.com/docs/features/access-control/auth-keys)
- [Tailscale ephemeral nodes](https://tailscale.com/docs/features/ephemeral-nodes)
- [Docker trên Render](https://render.com/docs/docker)
