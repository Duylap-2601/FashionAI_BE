import 'dotenv/config';
import { PrismaClient, Role, UserTier, GarmentCategory, ProductStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

/**
 * Mật khẩu seed phải đến từ biến môi trường. Hardcode trong repo nghĩa là bất kỳ ai
 * đọc được source cũng đăng nhập được vào tài khoản admin của môi trường đã seed.
 */
function requiredPassword(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(
      `${key} là bắt buộc để seed. Ví dụ: ${key}='<mật khẩu mạnh>' npm run prisma:seed`,
    );
  }
  if (value.length < 12) {
    throw new Error(`${key} phải dài tối thiểu 12 ký tự.`);
  }
  return value;
}

function assertSeedAllowed() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRODUCTION_SEED !== 'true') {
    throw new Error(
      'Từ chối seed khi NODE_ENV=production. Nếu thực sự cần, chạy lại với ALLOW_PRODUCTION_SEED=true.',
    );
  }
}

async function main() {
  assertSeedAllowed();
  console.log('🌱 Starting database seeding...');

  // Create Admin User
  const adminPasswordHash = await bcrypt.hash(requiredPassword('SEED_ADMIN_PASSWORD'), 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@fashionai.com' },
    update: {},
    create: {
      email: 'admin@fashionai.com',
      passwordHash: adminPasswordHash,
      name: 'System Admin',
      role: Role.ADMIN,
      tier: UserTier.VIP,
      isVerified: true,
      measurements: { create: {} },
    },
  });
  console.log(`✅ Admin user created: ${admin.email}`);

  // Create Demo Users (FREE + MEMBER + VIP tiers)
  const demoPasswordHash = await bcrypt.hash(requiredPassword('SEED_DEMO_PASSWORD'), 12);
  const demoUsers = [
    {
      email: 'demo@fashionai.com',
      name: 'Nguyen Van A',
      tier: UserTier.FREE,
      measurements: { height: 175, weight: 68, chest: 95, waist: 78, hip: 94 },
    },
    {
      email: 'member1@fashionai.com',
      name: 'Tran Thi B',
      tier: UserTier.MEMBER,
      measurements: { height: 162, weight: 52, chest: 84, waist: 66, hip: 90 },
    },
    {
      email: 'member2@fashionai.com',
      name: 'Le Van C',
      tier: UserTier.MEMBER,
      measurements: { height: 178, weight: 72, chest: 98, waist: 82, hip: 96 },
    },
    {
      email: 'vip1@fashionai.com',
      name: 'Pham Thi D',
      tier: UserTier.VIP,
      measurements: { height: 168, weight: 58, chest: 88, waist: 70, hip: 92 },
    },
    {
      email: 'vip2@fashionai.com',
      name: 'Hoang Van E',
      tier: UserTier.VIP,
      measurements: { height: 180, weight: 75, chest: 100, waist: 84, hip: 98 },
    },
  ];

  for (const demoUser of demoUsers) {
    const user = await prisma.user.upsert({
      where: { email: demoUser.email },
      update: {},
      create: {
        email: demoUser.email,
        passwordHash: demoPasswordHash,
        name: demoUser.name,
        role: Role.USER,
        tier: demoUser.tier,
        isVerified: true,
        measurements: { create: demoUser.measurements },
      },
    });
    console.log(`✅ Demo user created: ${user.email} (${demoUser.tier})`);
  }

  // Create Sample Garment Products
  const sampleProducts = [
    {
      name: 'Áo Sơ Mi Trắng Slim-Fit Công Sở',
      description: 'Áo sơ mi nam chất liệu cotton thoáng mát, đường may tinh tế phù hợp cho môi trường công sở.',
      category: GarmentCategory.UPPER,
      color: 'Trắng',
      price: 350000,
      stock: 100,
      garmentUrl: 'https://raw.githubusercontent.com/fashn-ai/fashn-python/main/examples/garments/shirt.jpg',
      status: ProductStatus.ACTIVE,
    },
    {
      name: 'Áo Blazer Nam Navy Blue Elegance',
      description: 'Áo khoác blazer phong cách Hàn Quốc trẻ trung, dễ phối đồ.',
      category: GarmentCategory.UPPER,
      color: 'Xanh Navy',
      price: 1250000,
      stock: 100,
      garmentUrl: 'https://raw.githubusercontent.com/fashn-ai/fashn-python/main/examples/garments/blazer.jpg',
      status: ProductStatus.ACTIVE,
    },
    {
      name: 'Quần Tây Nam Khaki Dáng Suông',
      description: 'Quần tây tây vải tuýt cao cấp chống nhăn, tôn dáng.',
      category: GarmentCategory.LOWER,
      color: 'Khaki',
      price: 490000,
      stock: 100,
      garmentUrl: 'https://raw.githubusercontent.com/fashn-ai/fashn-python/main/examples/garments/pants.jpg',
      status: ProductStatus.ACTIVE,
    },
  ];

  for (const productData of sampleProducts) {
    const existing = await prisma.product.findFirst({ where: { name: productData.name } });
    if (!existing) {
      await prisma.product.create({
        data: {
          ...productData,
          images: {
            create: [{ imageUrl: productData.garmentUrl, isMain: true }],
          },
        },
      });
    }
  }

  console.log('✅ Sample garment products seeded successfully.');
}

main()
  .catch((e) => {
    console.error('❌ Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
