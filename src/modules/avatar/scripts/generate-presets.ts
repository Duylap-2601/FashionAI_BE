/**
 * Sinh offline lưới GLB preset (gender x height x weight) cho tính năng Avatar 3D.
 * Chạy trên máy DEV có Blender + MPFB2 (không cần chạy trên production):
 *
 *   npm run presets:generate                # toàn bộ lưới (2 giới)
 *   npm run presets:generate -- --gender=female
 *   npm run presets:generate -- --height=150:170 --weight=40:80
 *   npm run presets:generate -- --no-upload   # chỉ lưu GLB local, không upload Cloudinary
 *
 * Với mỗi điểm lưới:
 *   - base = hình macro-only (tỷ lệ mặc định), GLB chứa đủ 8 morph measure-*
 *     (incr + decr) ở weight ~0 để FE tự áp morph theo số đo người dùng.
 *   - upload Cloudinary (public_id = preset_<gender>_<height>_<weight>)
 *   - upsert bảng avatar_presets với presetMeasurements = số đo thực đo lại.
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as cloudinary from 'cloudinary';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface Calibration {
  reference_cm: Record<string, Record<string, number>>;
  delta_cm_per_unit: Record<string, Record<string, number>>;
}

interface CliArgs {
  gender?: string;
  height: [number, number];
  weight: [number, number];
  force: boolean;
  noUpload: boolean;
  keepTmp: boolean;
  limit?: number;
}

const prisma = new PrismaClient();
const BLENDER = process.env.BLENDER_PRESET_PATH || process.env.BLENDER_PATH || 'blender';
const SCRIPT = process.env.AVATAR_SCRIPT_PATH
  ? path.resolve(process.env.AVATAR_SCRIPT_PATH)
  : path.join(process.cwd(), 'src', 'modules', 'avatar', 'blender', 'generate_avatar.py');
const CALIB_PATH = path.join(process.cwd(), 'src', 'modules', 'avatar', 'blender', 'calibration.json');
const TIMEOUT_MS = parseInt(process.env.AVATAR_TIMEOUT_MS || '120000', 10);
const MORPH_BASE = parseFloat(process.env.PRESET_MORPH_BASE || '0.05');

cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const get = (key: string) => {
    const hit = args.find((a) => a.startsWith(`--${key}=`));
    return hit ? hit.split('=')[1] : undefined;
  };
  const getRange = (key: string, def: [number, number]): [number, number] => {
    const v = get(key);
    if (!v) return def;
    const [a, b] = v.split(':').map((x) => parseInt(x, 10));
    if (Number.isNaN(a) || Number.isNaN(b) || b < a) throw new Error(`--${key} phải dạng min:max`);
    return [a, b];
  };
  const lim = get('limit');

  return {
    gender: get('gender'),
    height: getRange('height', [150, 190]),
    weight: getRange('weight', [40, 100]),
    force: args.includes('--force'),
    noUpload: args.includes('--no-upload'),
    keepTmp: args.includes('--keep-tmp'),
    limit: lim ? parseInt(lim, 10) : undefined,
  };
}

function step(start: number, end: number, by: number): number[] {
  const out: number[] = [];
  for (let v = start; v <= end; v += by) out.push(v);
  return out;
}

function loadCalibration(): Calibration {
  return JSON.parse(fs.readFileSync(CALIB_PATH, 'utf-8'));
}

function runBlender(configPath: string, glbPath: string): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const child = spawn(BLENDER, [
      '--background',
      '--python',
      SCRIPT,
      '--',
      configPath,
      glbPath,
    ]);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Blender timeout'));
    }, TIMEOUT_MS);

    child.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Blender exit ${code}: ${stderr.slice(-500)}`));
        return;
      }
      const line = stdout
        .split('\n')
        .find((l) => l.startsWith('AVATAR_RESULT=') || l.startsWith('AVATAR_ERROR='));
      if (!line) {
        reject(new Error(`Không có AVATAR_RESULT. stderr: ${stderr.slice(-500)}`));
        return;
      }
      const result = JSON.parse(line.slice(line.indexOf('=') + 1));
      if (!result.ok) reject(new Error(result.error || 'Blender script failed'));
      else resolve(result);
    });
  });
}

function uploadGlb(fileName: string, buffer: Buffer): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.v2.uploader.upload_stream(
      {
        folder: 'avatars/presets',
        public_id: fileName,
        resource_type: 'raw',
      },
      (err: any, res: any) => {
        if (err) reject(err);
        else resolve(res?.secure_url || res?.url || null);
      },
    );
    stream.end(buffer);
  });
}

async function main() {
  const args = parseArgs();
  const calib = loadCalibration();
  const genders = args.gender ? [args.gender] : ['female', 'male'];
  const heights = step(args.height[0], args.height[1], 5);
  const weights = step(args.weight[0], args.weight[1], 10);

  let total = 0;
  let ok = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const gender of genders) {
    if (!(gender === 'female' || gender === 'male')) {
      throw new Error(`gender phải là female|male, nhận ${gender}`);
    }
    const ref = calib.reference_cm[gender];
    for (const h of heights) {
      for (const w of weights) {
        total++;
        const name = `preset_${gender}_${h}_${w}`;

        if (!args.force) {
          const exists = await prisma.avatarPreset.findUnique({
            where: { gender_height_weight: { gender, height: h, weight: w } },
          });
          if (exists) {
            skipped++;
            console.log(`[skip] ${name} (đã tồn tại)`);
            continue;
          }
        }

        if (args.limit && ok >= args.limit) {
          console.log(`[stop] đạt giới hạn ${args.limit}`);
          break;
        }

        const scale = h / ref.height;
        const defaults = {
          chest: +(ref.bust * scale).toFixed(1),
          waist: +(ref.waist * scale).toFixed(1),
          hip: +(ref.hip * scale).toFixed(1),
          shoulder: +(ref.shoulder * scale).toFixed(1),
        };

        const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'presets-'));
        const configPath = path.join(workDir, 'input.json');
        const glbPath = path.join(workDir, `${name}.glb`);

        try {
          fs.writeFileSync(
            configPath,
            JSON.stringify({
              gender,
              height: h,
              weight: w,
              chest: defaults.chest,
              waist: defaults.waist,
              hip: defaults.hip,
              shoulder: defaults.shoulder,
              force_morph_targets: true,
              morph_base_value: MORPH_BASE,
              draco: true,
              morph: true,
            }),
          );

          const t0 = Date.now();
          const result = await runBlender(configPath, glbPath);
          const buffer = fs.readFileSync(glbPath);
          const seconds = ((Date.now() - t0) / 1000).toFixed(1);

          let glbUrl: string;
          if (args.noUpload) {
            const outDir = path.join(process.cwd(), 'storage', 'avatar-presets');
            fs.mkdirSync(outDir, { recursive: true });
            const outPath = path.join(outDir, `${name}.glb`);
            fs.writeFileSync(outPath, buffer);
            glbUrl = outPath;
          } else {
            glbUrl = (await uploadGlb(name, buffer))!;
          }

          const measured = result.measured_cm ?? {};
          await prisma.avatarPreset.upsert({
            where: { gender_height_weight: { gender, height: h, weight: w } },
            update: { glbUrl, presetMeasurements: measured },
            create: {
              gender,
              height: h,
              weight: w,
              glbUrl,
              presetMeasurements: {
                chest: +(measured.bust ?? defaults.chest).toFixed(1),
                waist: +(measured.waist ?? defaults.waist).toFixed(1),
                hip: +(measured.hip ?? defaults.hip).toFixed(1),
                shoulder: +(measured.shoulder ?? defaults.shoulder).toFixed(1),
              },
            },
          });

          ok++;
          console.log(
            `[ok] ${name} (${seconds}s, ${(buffer.length / 1024).toFixed(0)}KB) ` +
              `measured=${JSON.stringify(measured)}`,
          );
        } catch (err) {
          failed++;
          errors.push(`${name}: ${(err as Error).message}`);
          console.error(`[fail] ${name}: ${(err as Error).message}`);
        } finally {
          if (!args.keepTmp) fs.rmSync(workDir, { recursive: true, force: true });
        }
      }
    }
  }

  console.log(`\n===== Kết quả =====`);
  console.log(`Tổng: ${total} | ok: ${ok} | skipped: ${skipped} | failed: ${failed}`);
  if (errors.length) {
    console.log('Lỗi:');
    errors.forEach((e) => console.log(`  - ${e}`));
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
