# AI Fashion Try-On API - Tài Liệu Chi Tiết

## 📚 Tổng Quan Kiến Trúc

```
┌─────────────────┐
│   HTTP Client   │
│ (Browser/App)   │
└────────┬────────┘
         │ POST /api/try-on
         │ {humanImageUrl, garmentImageUrl}
         │
┌────────▼─────────────────────┐
│   NestJS Application         │
├──────────────────────────────┤
│   TryOnController            │  ◄─ HTTP Handler
│   ├─ @Post() tryOn()         │
│   └─ Validate Request        │
├──────────────────────────────┤
│   TryOnService               │  ◄─ Business Logic
│   ├─ generateTryOn()         │
│   ├─ Error Handling          │
│   └─ Gradio Integration      │
└────────┬─────────────────────┘
         │
         │ Gradio Client API Call
         │
┌────────▼─────────────────────┐
│  Hugging Face Gradio Space   │
│  Kwai-Kolors/Virtual-Try-On  │  ◄─ AI Model
│  (Kolors-VTO Model)          │
└──────────────────────────────┘
```

## 🔄 Luồng Xử Lý Request

### 1. **Request Validation (Controller)**
```
POST /api/try-on
{
  "humanImageUrl": "https://...",
  "garmentImageUrl": "https://..."
}
       ↓
   [ValidationPipe]
   - Kiểm tra field bắt buộc
   - Kiểm tra URL hợp lệ
   - Transform data
       ↓
   [TryOnRequestDto]
   - Xác thực thành công → Truyền tới Service
   - Xác thực thất bại → Response 400
```

### 2. **AI Processing (Service)**
```
Service.generateTryOn()
       ↓
   [Try Block]
   - Connect Gradio Client
   - Send request to AI Model
   - Handle with Timeout
       ↓
   [Success] → Return resultImageUrl
   ↓
   [Error] → Catch block
   - Timeout Error → 408
   - Overload Error → 429
   - Connection Error → 503
   - Other Error → 500
```

### 3. **Response**
```
Success (200):
{
  "statusCode": 200,
  "message": "Virtual try-on thành công",
  "data": {
    "resultImageUrl": "...",
    "status": "success"
  }
}

Error (4xx/5xx):
{
  "statusCode": 408|429|503|500,
  "message": "Chi tiết lỗi",
  "error": "Error code"
}
```

## 📋 Chi Tiết Các File

### [main.ts](../src/main.ts) - Entry Point
**Trách vụ:**
- Khởi tạo NestJS application
- Cấu hình Global Middleware
- Enable CORS
- Setup Validation Pipes
- Start server trên PORT

**Điểm quan trọng:**
```typescript
// Global Validation Pipe - áp dụng cho TẤT CẢ routes
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,           // Loại bỏ field không được định nghĩa
    forbidNonWhitelisted: true, // Báo lỗi nếu có field extra
    transform: true,            // Tự động convert types
  }),
);
```

### [app.module.ts](../src/app.module.ts) - Root Module
**Trách vụ:**
- Import tất cả feature modules
- Định nghĩa global providers

**Cấu trúc:**
```typescript
@Module({
  imports: [TryOnModule], // Import feature module
  controllers: [],         // Không có controller ở root
  providers: [],          // Không có provider ở root
})
export class AppModule {}
```

### [try-on.module.ts](../src/try-on/try-on.module.ts) - Feature Module
**Trách vụ:**
- Nhóm tất cả dependencies liên quan Virtual Try-On
- Export Service để reuse nếu cần

**Cấu trúc:**
```typescript
@Module({
  controllers: [TryOnController],  // HTTP Handler
  providers: [TryOnService],       // Business Logic
  exports: [TryOnService],         // Cho phép reuse ở module khác
})
export class TryOnModule {}
```

### [try-on.controller.ts](../src/try-on/try-on.controller.ts) - HTTP Handler
**Trách vụ:**
- Nhận HTTP requests từ client
- Validate request body
- Gọi Service
- Format response

**Key Methods:**
```typescript
@Post()
async tryOn(@Body() tryOnRequest: TryOnRequestDto) {
  // Body validation tự động do @Body() decorator + ValidationPipe
  // Nếu validation fail → 400 error tự động
  // Nếu thành công → tryOnRequest được pass tới method
}
```

**Error Handling:**
- Validation errors → 400 (tự động)
- Service throws HttpException → Format response (tự động)
- Uncaught errors → 500 (tự động)

### [try-on.service.ts](../src/try-on/try-on.service.ts) - Business Logic
**Trách vụ:**
- Xử lý logic gọi Gradio AI
- Xử lý lỗi toàn diện
- Logging

**Key Features:**

1. **Gradio Client Connection**
```typescript
const client = await Client.connect(this.GRADIO_SPACE_URL);
// Kết nối tới Hugging Face Space
```

2. **Timeout Handling**
```typescript
await Promise.race([
  client.predict('/tryon', [humanImageUrl, garmentImageUrl]),
  new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error('timeout')),
      this.TIMEOUT_MS,
    ),
  ),
]);
// Nếu predict() chạy quá TIMEOUT_MS → reject timeout error
```

3. **Error Classification**
```typescript
if (error.includes('timeout')) {
  // Status 408
} else if (error.includes('overload')) {
  // Status 429
} else if (error.includes('Connection')) {
  // Status 503
} else {
  // Status 500
}
```

### [try-on-request.dto.ts](../src/try-on/dto/try-on-request.dto.ts) - Request DTO
**Trách vụ:**
- Define request body structure
- Validation rules

**Validation Rules:**
```typescript
@IsNotEmpty()           // Bắt buộc có
@IsString()             // Phải là string
@IsUrl({require_protocol: true})  // Phải là URL có http/https
humanImageUrl: string;
```

## 🔐 Security Considerations

### 1. **Input Validation**
- ✅ URL validation (http/https required)
- ✅ Required fields validation
- ✅ Whitelist unknown fields rejection

### 2. **Error Exposure**
- ✅ Production errors hide details
- ✅ Development logs chi tiết lỗi
- ✅ Không expose sensitive information

### 3. **CORS**
```typescript
app.enableCors({
  origin: '*',  // ⚠️ Không an toàn cho production
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
});
```
**Khuyến nghị cho Production:**
```typescript
app.enableCors({
  origin: ['https://yourdomain.com'],
  methods: ['POST'],
  credentials: true,
});
```

### 4. **Rate Limiting** (Nên thêm)
```bash
npm install @nestjs/throttler
```
Sau đó add decorator:
```typescript
@Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 requests/minute
@Post()
async tryOn(...) {}
```

## ⚡ Performance Optimization

### 1. **Timeout Strategy**
Hiện tại: 120 giây (2 phút)
- Đủ cho hầu hết cases
- Có thể điều chỉnh tùy model performance

### 2. **Connection Pooling** (Optional)
Nếu scale lớn, có thể tái sử dụng Gradio client:
```typescript
private client: Client;

async onModuleInit() {
  this.client = await Client.connect(this.GRADIO_SPACE_URL);
}

async generateTryOn(...) {
  // Reuse this.client thay vì kết nối mỗi lần
}
```

### 3. **Caching** (Optional)
```bash
npm install @nestjs/cache-manager
```
Cache kết quả nếu cùng input:
```typescript
@UseInterceptors(CacheInterceptor)
@Post()
async tryOn(...) {}
```

## 🧪 Testing

### Unit Test Service
```typescript
describe('TryOnService', () => {
  it('should generate try-on image', async () => {
    const result = await service.generateTryOn(
      'https://example.com/person.jpg',
      'https://example.com/shirt.jpg'
    );
    expect(result.status).toBe('success');
    expect(result.resultImageUrl).toBeDefined();
  });

  it('should handle timeout error', async () => {
    jest.spyOn(Client, 'connect').mockImplementation(
      () => new Promise(resolve => setTimeout(resolve, 200000))
    );
    
    await expect(service.generateTryOn(...)).rejects.toThrow();
  });
});
```

### Integration Test Controller
```typescript
describe('TryOnController', () => {
  it('POST /api/try-on should return result image', async () => {
    return request(app.getHttpServer())
      .post('/api/try-on')
      .send({
        humanImageUrl: 'https://example.com/person.jpg',
        garmentImageUrl: 'https://example.com/shirt.jpg'
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.resultImageUrl).toBeDefined();
      });
  });
});
```

## 🚀 Deployment

### Docker
```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/

EXPOSE 3000
CMD ["node", "dist/main.js"]
```

Build & Run:
```bash
docker build -t ai-tryon-api .
docker run -p 3000:3000 ai-tryon-api
```

### Environment-specific Config
```typescript
// main.ts
const isDevelopment = process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production';

app.enableCors({
  origin: isDevelopment ? '*' : ['https://yourdomain.com'],
});
```

## 📊 Monitoring & Logging

### Current Logging
```typescript
private readonly logger = new Logger(TryOnService.name);

this.logger.log('Success message');
this.logger.error('Error message', error);
this.logger.warn('Warning message');
this.logger.debug('Debug info');
```

### Enhancement (Optional)
Thêm Winston Logger:
```bash
npm install nest-winston winston
```

```typescript
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';

const logger = WinstonModule.createLogger({
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});
```

## 🔗 Integration dengan Frontend

### React Example
```jsx
async function tryOnOutfit(personImage, garmentImage) {
  try {
    const response = await fetch('http://localhost:3000/api/try-on', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        humanImageUrl: personImage,
        garmentImageUrl: garmentImage
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    return result.data.resultImageUrl;
  } catch (error) {
    console.error('Try-on failed:', error);
    // Handle error - show user-friendly message
  }
}
```

---

**Chú ý:** Đây là template production-ready. Tùy vào requirement cụ thể, có thể cần thêm authentication, rate limiting, advanced error handling, v.v.
