import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  StreamableFile,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { RedisService } from '../../common/services/redis.service';
import { Avatar as AvatarEntity } from '@prisma/client';
import { GenerateAvatarDto } from './dto/generate-avatar.dto';

export interface AvatarResult {
  id: string;
  gender: string;
  glbUrl: string;
  isCached: boolean;
  createdAt: Date;
  measurements: {
    height?: number | null;
    weight?: number | null;
    chest?: number | null;
    waist?: number | null;
    hip?: number | null;
    shoulder?: number | null;
  };
  measuredCm?: Record<string, number>;
  timingS?: Record<string, number>;
}

@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);

  private readonly blenderPath: string;
  private readonly scriptPath: string;
  private readonly storageDir: string;
  private readonly publicBaseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly redisService: RedisService,
  ) {
    this.blenderPath =
      this.config.get<string>('BLENDER_PATH') ?? 'blender';
    this.scriptPath =
      this.config.get<string>('AVATAR_SCRIPT_PATH') ??
      path.join(process.cwd(), 'src', 'modules', 'avatar', 'blender', 'generate_avatar.py');
    this.storageDir =
      this.config.get<string>('AVATAR_STORAGE_DIR') ?? 'storage/avatars';
    this.publicBaseUrl =
      this.config.get<string>('AVATAR_PUBLIC_BASE_URL') ??
      `${this.config.get<string>('PUBLIC_API_URL') ?? 'http://localhost:3000'}/api/avatar`;
    this.timeoutMs = parseInt(this.config.get<string>('AVATAR_TIMEOUT_MS') ?? '60000', 10);

    if (!fs.existsSync(this.scriptPath)) {
      this.logger.error(`Không tìm thấy script avatar: ${this.scriptPath}`);
    } else {
      this.logger.log(
        `Avatar pipeline ready | blender=${this.blenderPath} | script=${this.scriptPath}`,
      );
    }
  }

  async generate(userId: string, dto: GenerateAvatarDto): Promise<AvatarResult> {
    const cacheKey = this.buildCacheKey(dto);

    const lockKey = `lock:avatar:${userId}:${cacheKey}`;
    const acquired = await this.redisService.acquireLock(lockKey, 60);
    if (!acquired) {
      throw new ServiceUnavailableException(
        'Avatar tương tự đang được tạo. Vui lòng thử lại trong giây lát.',
      );
    }

    try {
      const cached = await this.prisma.avatar.findUnique({
        where: { userId_cacheKey: { userId, cacheKey } },
      });
      if (cached) {
        this.logger.log(`[Avatar] Cache hit cho user ${userId}`);
        return this.toResult(cached, true);
      }

      const generated = await this.runBlender(userId, dto, cacheKey);

      const saved = await this.prisma.avatar.create({
        data: {
          userId,
          gender: dto.gender,
          height: dto.height,
          weight: dto.weight,
          chest: dto.chest,
          waist: dto.waist,
          hip: dto.hip,
          shoulder: dto.shoulder,
          glbUrl: generated.glbUrl,
          cacheKey,
        },
      });

      return this.toResult(saved, false, generated.measuredCm, generated.timingS);
    } finally {
      await this.redisService.releaseLock(lockKey);
    }
  }

  async getById(userId: string, id: string) {
    const avatar = await this.prisma.avatar.findFirst({ where: { id, userId } });
    if (!avatar) throw new NotFoundException('Không tìm thấy avatar');
    return avatar;
  }

  async getLatest(userId: string) {
    return this.prisma.avatar.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  getGlbFilePath(fileName: string): string {
    return path.join(this.storageDir, `${fileName}.glb`);
  }

  /**
   * Trả file GLB đã lưu local. fileName chỉ chấp nhận ký tự an toàn để tránh
   * path traversal (không cho '..' hay path separator).
   */
  streamFile(fileName: string): StreamableFile {
    if (!/^[A-Za-z0-9_-]+$/.test(fileName)) {
      throw new NotFoundException('File GLB không hợp lệ');
    }
    const filePath = this.getGlbFilePath(fileName);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('File GLB không tồn tại trên server');
    }
    return new StreamableFile(fs.createReadStream(filePath), {
      type: 'model/gltf-binary',
      disposition: `inline; filename="avatar-${fileName}.glb"`,
      length: fs.statSync(filePath).size,
    });
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private buildCacheKey(dto: GenerateAvatarDto): string {
    const raw = [
      dto.gender,
      dto.height,
      dto.weight,
      dto.chest,
      dto.waist,
      dto.hip,
      dto.shoulder,
    ]
      .map((v) => Number(v).toFixed(1))
      .join(':');
    return crypto.createHash('md5').update(raw).digest('hex');
  }

  private runBlender(
    userId: string,
    dto: GenerateAvatarDto,
    cacheKey: string,
  ): Promise<{ glbUrl: string; measuredCm: Record<string, number>; timingS: Record<string, number> }> {
    return new Promise((resolve, reject) => {
      const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-'));
      const configPath = path.join(workDir, 'input.json');
      const glbPath = path.join(workDir, 'avatar.glb');

      fs.writeFileSync(
        configPath,
        JSON.stringify({
          gender: dto.gender,
          height: dto.height,
          weight: dto.weight,
          chest: dto.chest,
          waist: dto.waist,
          hip: dto.hip,
          shoulder: dto.shoulder,
          draco: dto.draco ?? true,
          morph: dto.morph ?? true,
        }),
      );

      const child = spawn(this.blenderPath, [
        '--background',
        '--python',
        this.scriptPath,
        '--',
        configPath,
        glbPath,
      ]);

      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new ServiceUnavailableException('Blender pipeline hết thời gian chờ.'));
      }, this.timeoutMs);

      child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
      child.stderr.on('data', (chunk) => (stderr += chunk.toString()));

      child.on('error', (err) => {
        clearTimeout(timer);
        this.logger.error(`[Avatar] Không thể khởi chạy Blender: ${err.message}`);
        reject(
          new ServiceUnavailableException(
            'Không thể khởi chạy Blender pipeline. Kiểm tra BLENDER_PATH và cài đặt MPFB2.',
          ),
        );
      });

      child.on('close', async (code) => {
        clearTimeout(timer);

        if (code !== 0) {
          fs.rmSync(workDir, { recursive: true, force: true });
          this.logger.error(`[Avatar] Blender exit code ${code}. stderr: ${stderr.slice(-1000)}`);
          reject(
            new BadRequestException(
              'Không thể tạo avatar. Kiểm tra log server (stderr Blender) để biết chi tiết.',
            ),
          );
          return;
        }

        const result = this.parseResult(stdout);
        let glbBuffer: Buffer;
        try {
          glbBuffer = fs.readFileSync(glbPath);
        } catch {
          glbBuffer = Buffer.alloc(0);
        }
        fs.rmSync(workDir, { recursive: true, force: true });

        if (!result || !result.ok || glbBuffer.length === 0) {
          this.logger.error(`[Avatar] Script trả kết quả lỗi: ${stderr.slice(-1000)}`);
          reject(new BadRequestException('Blender script không sinh được GLB avatar.'));
          return;
        }

        try {
          const glbUrl = await this.persistGlb(userId, cacheKey, glbBuffer);
          resolve({
            glbUrl,
            measuredCm: result.measured_cm ?? {},
            timingS: result.timing_s ?? {},
          });
        } catch (err) {
          this.logger.error(`[Avatar] Lưu trữ GLB thất bại: ${(err as Error).message}`);
          reject(new ServiceUnavailableException('Không thể lưu trữ file GLB.'));
        }
      });
    });
  }

  private parseResult(stdout: string) {
    const line = stdout
      .split('\n')
      .find((l) => l.startsWith('AVATAR_RESULT=') || l.startsWith('AVATAR_ERROR='));
    if (!line) return null;
    return JSON.parse(line.slice(line.indexOf('=') + 1));
  }

  private async persistGlb(
    userId: string,
    cacheKey: string,
    buffer: Buffer,
  ): Promise<string> {
    const fileName = `avatar_${userId}_${cacheKey}`;

    const cloudinaryUrl = await this.storageService.uploadRaw(
      buffer,
      'avatars',
      `${fileName}.glb`,
    );
    if (cloudinaryUrl) {
      return cloudinaryUrl;
    }

    // Fallback local: lưu file vào storageDir và phục vụ qua GET /avatar/:name/file
    fs.mkdirSync(this.storageDir, { recursive: true });
    const finalPath = this.getGlbFilePath(fileName);
    fs.writeFileSync(finalPath, buffer);
    this.logger.log(`[Avatar] Lưu local: ${finalPath} (${buffer.length} bytes)`);
    return `${this.publicBaseUrl}/${fileName}/file`;
  }

  private toResult(
    avatar: AvatarEntity,
    isCached: boolean,
    measuredCm?: Record<string, number>,
    timingS?: Record<string, number>,
  ): AvatarResult {
    return {
      id: avatar.id,
      gender: avatar.gender,
      glbUrl: avatar.glbUrl,
      isCached,
      createdAt: avatar.createdAt,
      measurements: {
        height: avatar.height ? Number(avatar.height) : null,
        weight: avatar.weight ? Number(avatar.weight) : null,
        chest: avatar.chest ? Number(avatar.chest) : null,
        waist: avatar.waist ? Number(avatar.waist) : null,
        hip: avatar.hip ? Number(avatar.hip) : null,
        shoulder: avatar.shoulder ? Number(avatar.shoulder) : null,
      },
      measuredCm,
      timingS,
    };
  }
}
