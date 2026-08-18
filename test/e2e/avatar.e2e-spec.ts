import { EventEmitter } from 'events';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import request from 'supertest';
import * as fs from 'fs';
import * as path from 'path';
import { UserTier } from '@prisma/client';
import { AvatarController } from '../../src/modules/avatar/avatar.controller';
import { AvatarService } from '../../src/modules/avatar/avatar.service';
import { StorageService } from '../../src/modules/storage/storage.service';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import {
  createPrismaMock,
  createRedisMock,
  createTestApp,
  PrismaMock,
} from './helpers/test-app';

jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  return {
    ...actual,
    spawn: jest.fn(),
  };
});

import { spawn } from 'child_process';
const mockedSpawn = spawn as jest.Mock;

const TEST_STORAGE_DIR = path.join(
  process.cwd(),
  'test',
  'e2e',
  'tmp-avatar-storage',
);

function authGuardFor(userId: string) {
  return {
    canActivate: (context: any) => {
      context.switchToHttp().getRequest().user = {
        id: userId,
        email: `${userId}@test.com`,
        tier: UserTier.MEMBER,
      };
      return true;
    },
  };
}

/**
 * Mô phỏng Blender spawn: ghi file GLB giả vào glbPath (arg cuối), emit dòng
 * AVATAR_RESULT ra stdout rồi close với code 0.
 */
function mockBlenderSuccess(payload: Record<string, unknown>) {
  mockedSpawn.mockImplementation((_bin: string, args: string[]) => {
    const glbPath = args[args.length - 1];
    fs.mkdirSync(path.dirname(glbPath), { recursive: true });
    fs.writeFileSync(glbPath, Buffer.from('GLB-DUMMY-CONTENT'));

    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = jest.fn();

    setImmediate(() => {
      child.stdout.emit('data', `AVATAR_RESULT=${JSON.stringify(payload)}\n`);
      child.emit('close', 0);
    });

    return child;
  });
}

describe('Avatar 3D generate (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaMock;

  async function bootstrap(userId: string) {
    prisma = createPrismaMock();
    const redis = createRedisMock();

    // local fallback: không upload Cloudinary
    const storageMock = {
      uploadRaw: jest.fn().mockResolvedValue(null),
      get isCloudinaryReady() {
        return false;
      },
    };

    const created = await createTestApp({
      prisma,
      redis,
      metadata: {
        imports: [
          ConfigModule.forRoot({
            load: [
              () => ({
                BLENDER_PATH: 'blender-test',
                AVATAR_STORAGE_DIR: TEST_STORAGE_DIR,
                AVATAR_PUBLIC_BASE_URL: 'http://test.local/api/avatar',
                NODE_ENV: 'test',
              }),
            ],
          }),
        ],
        controllers: [AvatarController],
        providers: [
          AvatarService,
          {
            provide: StorageService,
            useValue: storageMock,
          },
        ],
      },
      configure: (builder) =>
        builder
          .overrideGuard(JwtAuthGuard)
          .useValue(authGuardFor(userId)),
    });

    app = created.app;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    if (fs.existsSync(TEST_STORAGE_DIR)) {
      fs.rmSync(TEST_STORAGE_DIR, { recursive: true, force: true });
    }
  });

  afterEach(async () => {
    if (app) await app.close();
    if (fs.existsSync(TEST_STORAGE_DIR)) {
      fs.rmSync(TEST_STORAGE_DIR, { recursive: true, force: true });
    }
  });

  const validBody = {
    gender: 'female',
    height: 165,
    weight: 56,
    chest: 88,
    waist: 70,
    hip: 94,
    shoulder: 39,
  };

  it('POST /avatar/generate tạo avatar mới, lưu local và trả glbUrl', async () => {
    await bootstrap('user-a');
    mockBlenderSuccess({
      ok: true,
      glb_kb: 123,
      measured_cm: { height: 165.0, bust: 87.7, waist: 69.9, hip: 95.5, shoulder: 39.4 },
      timing_s: { total: 1.9 },
    });

    prisma.avatar.findUnique.mockResolvedValue(null);
    prisma.avatar.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 'avatar-1',
        ...data,
        createdAt: new Date(),
      }),
    );

    const res = await request(app.getHttpServer())
      .post('/api/avatar/generate')
      .send(validBody)
      .expect(201);

    expect(res.body.data.isCached).toBe(false);
    expect(res.body.data.id).toBe('avatar-1');
    expect(res.body.data.glbUrl).toMatch(
      /^http:\/\/test\.local\/api\/avatar\/avatar_user-a_[a-f0-9]{32}\/file$/,
    );
    expect(res.body.data.measuredCm.height).toBeCloseTo(165.0);
    expect(res.body.data.timingS.total).toBeCloseTo(1.9);

    // GLB phải được lưu vào storageDir local
    const files = fs.readdirSync(TEST_STORAGE_DIR);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^avatar_user-a_[a-f0-9]{32}\.glb$/);

    // Lưu DB với cacheKey chuẩn hoá
    const createArg = prisma.avatar.create.mock.calls[0][0];
    expect(createArg.data).toMatchObject({
      userId: 'user-a',
      gender: 'female',
      height: 165,
      waist: 70,
    });
    expect(createArg.data.cacheKey).toMatch(/^[a-f0-9]{32}$/);
  });

  it('cùng số đo → trả cache, không gọi spawn Blender', async () => {
    await bootstrap('user-a');

    prisma.avatar.findUnique.mockResolvedValue({
      id: 'cached-1',
      userId: 'user-a',
      gender: 'female',
      height: 165,
      weight: 56,
      chest: 88,
      waist: 70,
      hip: 94,
      shoulder: 39,
      glbUrl: 'https://cdn.test/avatar.glb',
      cacheKey: 'x',
      createdAt: new Date(),
    });

    const res = await request(app.getHttpServer())
      .post('/api/avatar/generate')
      .send(validBody)
      .expect(201);

    expect(res.body.data.isCached).toBe(true);
    expect(res.body.data.glbUrl).toBe('https://cdn.test/avatar.glb');
    expect(mockedSpawn).not.toHaveBeenCalled();
    expect(prisma.avatar.create).not.toHaveBeenCalled();
  });

  it('GET /avatar/:name/file trả file GLB khi đã lưu local', async () => {
    await bootstrap('user-a');
    mockBlenderSuccess({ ok: true, glb_kb: 1, measured_cm: {}, timing_s: {} });

    prisma.avatar.findUnique.mockResolvedValue(null);
    prisma.avatar.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 'avatar-1',
        ...data,
        createdAt: new Date(),
      }),
    );

    await request(app.getHttpServer())
      .post('/api/avatar/generate')
      .send(validBody)
      .expect(201);

    const fileUrl = fs
      .readdirSync(TEST_STORAGE_DIR)[0]
      .replace(/\.glb$/, '');
    await request(app.getHttpServer())
      .get(`/api/avatar/${fileUrl}/file`)
      .expect(200)
      .expect('Content-Type', /model\/gltf-binary/)
      .expect((res) => {
        expect(res.text).toBe('GLB-DUMMY-CONTENT');
      });
  });

  it('path traversal: tên file không hợp lệ bị từ chối', async () => {
    await bootstrap('user-a');

    await request(app.getHttpServer())
      .get('/api/avatar/..%2F..%2F.env/file')
      .expect(404);
  });

  it('validation: bỏ sót số đo → 400', async () => {
    await bootstrap('user-a');

    const { chest: _chest, ...missing } = validBody;
    await request(app.getHttpServer())
      .post('/api/avatar/generate')
      .send(missing)
      .expect(400);
  });
});
