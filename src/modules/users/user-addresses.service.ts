import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, UserAddress } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ShippingService } from '../shipping/shipping.service';
import { UpsertUserAddressDto } from './dto/user-address.dto';

const ADDRESS_LIMIT = 10;
// Street line ngắn hơn mức này gần như chắc chắn không phải địa chỉ thật
// (GHN cũng thường trả TO_ADDRESS_CONFLICT cho các case này).
const MIN_ADDRESS_LINE_LENGTH = 5;

@Injectable()
export class UserAddressesService {
  private readonly logger = new Logger(UserAddressesService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly shippingService: ShippingService,
  ) {}

  findAll(userId: string) {
    return this.prisma.userAddress.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async create(userId: string, dto: UpsertUserAddressDto) {
    const normalized = await this.normalizeInput(dto, true);
    return this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const count = await tx.userAddress.count({ where: { userId } });
      if (count >= ADDRESS_LIMIT) {
        throw new BadRequestException({ code: 'ADDRESS_LIMIT_REACHED', message: 'Mỗi tài khoản chỉ được lưu tối đa 10 địa chỉ.' });
      }
      const makeDefault = count === 0 || dto.isDefault === true;
      if (makeDefault) await tx.userAddress.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false, version: { increment: 1 } } });
      return tx.userAddress.create({ data: { userId, ...normalized, isDefault: makeDefault } });
    });
  }

  async update(userId: string, id: string, dto: UpsertUserAddressDto) {
    const current = await this.prisma.userAddress.findFirst({
      where: { id, userId },
      select: { ghnProvinceV3Id: true, ghnWardV3Id: true },
    });
    const locationChanged =
      !current ||
      current.ghnProvinceV3Id !== dto.ghnProvinceV3Id?.trim() ||
      current.ghnWardV3Id !== dto.ghnWardV3Id?.trim();
    const normalized = await this.normalizeInput(dto, locationChanged);
    return this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const current = await tx.userAddress.findFirst({ where: { id, userId } });
      if (!current) throw new NotFoundException('Không tìm thấy địa chỉ.');
      if (dto.expectedVersion !== undefined && current.version !== dto.expectedVersion) {
        throw new ConflictException({ code: 'ADDRESS_VERSION_CONFLICT', message: 'Địa chỉ đã được cập nhật ở nơi khác. Vui lòng tải lại.' });
      }
      const makeDefault = dto.isDefault === true || current.isDefault;
      if (makeDefault) await tx.userAddress.updateMany({ where: { userId, id: { not: id }, isDefault: true }, data: { isDefault: false, version: { increment: 1 } } });
      return tx.userAddress.update({ where: { id }, data: { ...normalized, isDefault: makeDefault, version: { increment: 1 } } });
    });
  }

  async remove(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const current = await tx.userAddress.findFirst({ where: { id, userId } });
      if (!current) throw new NotFoundException('Không tìm thấy địa chỉ.');
      await tx.userAddress.delete({ where: { id } });
      if (current.isDefault) {
        const next = await tx.userAddress.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } });
        if (next) await tx.userAddress.update({ where: { id: next.id }, data: { isDefault: true, version: { increment: 1 } } });
      }
      return { deleted: true };
    });
  }

  async setDefault(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const current = await tx.userAddress.findFirst({ where: { id, userId } });
      if (!current) throw new NotFoundException('Không tìm thấy địa chỉ.');
      await tx.userAddress.updateMany({ where: { userId, id: { not: id }, isDefault: true }, data: { isDefault: false, version: { increment: 1 } } });
      return tx.userAddress.update({ where: { id }, data: { isDefault: true, version: { increment: 1 } } });
    });
  }

  async findOwned(userId: string, id: string) {
    const address = await this.prisma.userAddress.findFirst({ where: { id, userId } });
    if (!address) throw new NotFoundException({ code: 'ADDRESS_INVALID', message: 'Không tìm thấy địa chỉ giao hàng.' });
    return address;
  }

  toShippingInfo(address: UserAddress, shippingNote?: string) {
    const fullAddress = [address.addressLine, address.wardName, address.provinceName].filter(Boolean).join(', ');
    return {
      addressId: address.id,
      addressVersion: address.version,
      name: address.recipientName,
      phone: address.phone,
      address: fullAddress,
      addressLine: address.addressLine,
      label: address.label ?? undefined,
      provinceName: address.provinceName,
      wardName: address.wardName,
      note: shippingNote ?? '',
      notes: shippingNote ?? '',
      ghnProvinceV3Id: address.ghnProvinceV3Id ?? undefined,
      ghnWardV3Id: address.ghnWardV3Id ?? undefined,
    };
  }

  private async normalizeInput(dto: UpsertUserAddressDto, probeDeliverability: boolean) {
    const recipientName = dto.recipientName.trim();
    const phone = this.normalizePhone(dto.phone);
    const addressLine = dto.addressLine.trim();
    const label = dto.label?.trim() || null;
    if (!recipientName || !addressLine) throw new BadRequestException({ code: 'ADDRESS_INVALID', message: 'Vui lòng nhập đầy đủ tên người nhận và địa chỉ.' });
    if (addressLine.length < MIN_ADDRESS_LINE_LENGTH) {
      throw new BadRequestException({ code: 'ADDRESS_INVALID', message: 'Vui lòng nhập số nhà và tên đường đầy đủ.' });
    }
    const location = await this.shippingService.validateGhnLocation(dto.ghnProvinceV3Id, dto.ghnWardV3Id);
    if (probeDeliverability) {
      await this.probeDeliverability({ name: recipientName, phone, addressLine }, location);
    }
    return { recipientName, phone, addressLine, label, ...location };
  }

  /**
   * Hỏi GHN thử một preview kiện 500g để bắt địa chỉ GHN không giao được
   * (sai phường/xã, khu vực khóa) ngay lúc lưu, thay vì đợi tới checkout.
   * Chỉ reject khi GHN khẳng định địa chỉ sai; mọi lỗi khác (mất mạng,
   * chưa cấu hình pickup, route theo kiện thực tế) thì cho lưu và để
   * quote-time validation quyết định.
   */
  private async probeDeliverability(
    contact: { name: string; phone: string; addressLine: string },
    location: { ghnProvinceV3Id: string; ghnWardV3Id: string; provinceName: string; wardName: string },
  ) {
    try {
      await this.shippingService.calculateFee({
        receiver: {
          name: contact.name,
          phone: contact.phone,
          address: [contact.addressLine, location.wardName, location.provinceName].filter(Boolean).join(', '),
          provinceId: location.ghnProvinceV3Id,
          provinceName: location.provinceName,
          wardId: location.ghnWardV3Id,
          wardName: location.wardName,
        },
        weight: 500,
        dimensions: { length: 25, width: 20, height: 8 },
        insuranceValue: 0,
        codAmount: 0,
        content: 'FashionAI address check',
      });
    } catch (error) {
      if (error instanceof HttpException) {
        const res = error.getResponse() as { code?: string };
        if (res?.code === 'ADDRESS_RECONFIRM_REQUIRED') throw error;
      }
      this.logger.warn(`GHN address probe skipped, quote-time validation remains | error=${error instanceof Error ? error.message : 'unknown'}`);
    }
  }

  private normalizePhone(value: string) {
    const compact = value.trim().replace(/[\s.-]/g, '');
    const normalized = compact.startsWith('+84') ? `0${compact.slice(3)}` : compact;
    if (!/^0(3|5|7|8|9)\d{8}$/.test(normalized)) {
      throw new BadRequestException({ code: 'ADDRESS_INVALID', message: 'Số điện thoại Việt Nam không hợp lệ.' });
    }
    return normalized;
  }

  private async lockUser(tx: Prisma.TransactionClient, userId: string) {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
  }
}
