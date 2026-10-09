import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  NotificationType,
  OrderIssueResolution,
  OrderIssueStatus,
  OrderStatus,
  Prisma,
  RefundStatus,
  Role,
} from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { NotificationService } from "../notification/notification.service";
import { OrdersService } from "../orders/orders.service";
import { StorageService } from "../storage/storage.service";
import { CreateOrderIssueDto } from "./dto/create-order-issue.dto";
import { QueryOrderIssueDto } from "./dto/query-order-issue.dto";
import { ResolveOrderIssueDto } from "./dto/resolve-order-issue.dto";
import { ReviewOrderIssueDto } from "./dto/review-order-issue.dto";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_INT4 = 2147483647;
const ISSUE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const issueInclude = {
  order: { select: { id: true, orderCode: true, status: true } },
  orderItem: {
    select: {
      id: true,
      productId: true,
      quantity: true,
      color: true,
      productNameSnapshot: true,
      productImageSnapshot: true,
    },
  },
  user: { select: { id: true, name: true, email: true } },
} satisfies Prisma.OrderIssueInclude;

@Injectable()
export class OrderIssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly storageService: StorageService,
    private readonly ordersService: OrdersService,
  ) {}

  async create(
    userId: string,
    orderId: string,
    orderItemId: string,
    dto: CreateOrderIssueDto,
    files: Express.Multer.File[] = [],
  ) {
    const order = await this.findOrderForOwner(userId, orderId);

    if (order.status !== OrderStatus.COMPLETED) {
      throw new BadRequestException(
        "Chỉ có thể báo lỗi khi đơn hàng đã hoàn tất (COMPLETED)",
      );
    }

    const item = await this.prisma.orderItem.findFirst({
      where: { id: orderItemId, orderId: order.id },
    });
    if (!item) {
      throw new NotFoundException("Không tìm thấy sản phẩm thuộc đơn hàng");
    }

    await this.assertWithinIssueWindow(order.id, order.updatedAt);

    const activeIssue = await this.prisma.orderIssue.findFirst({
      where: {
        orderItemId: item.id,
        status: { in: [OrderIssueStatus.PENDING, OrderIssueStatus.APPROVED] },
      },
      select: { id: true },
    });
    if (activeIssue) {
      throw new BadRequestException(
        "Sản phẩm này đã có yêu cầu xử lý đang chờ giải quyết",
      );
    }

    const evidenceImages: string[] = [];
    for (const file of files) {
      evidenceImages.push(
        await this.storageService.uploadImage(file.buffer, "order-issues"),
      );
    }

    const issue = await this.prisma.orderIssue.create({
      data: {
        orderId: order.id,
        orderItemId: item.id,
        userId,
        reason: dto.reason,
        description: dto.description,
        desiredResolution: dto.desiredResolution,
        evidenceImages:
          evidenceImages.length > 0 ? evidenceImages : Prisma.DbNull,
      },
      include: issueInclude,
    });

    this.notifyAdminsNewIssue(issue.id, order.orderCode).catch(() => undefined);

    return issue;
  }

  async findByOrder(
    orderId: string,
    userId: string,
    isAdmin: boolean,
    query: QueryOrderIssueDto,
  ) {
    const order = isAdmin
      ? await this.findOrderByIdentifier(orderId)
      : await this.findOrderForOwner(userId, orderId);
    if (!order) {
      throw new NotFoundException(`Không tìm thấy đơn hàng có ID ${orderId}`);
    }

    const { page = 1, limit = 20 } = query;
    const where: Prisma.OrderIssueWhereInput = {
      orderId: order.id,
      ...(query.status ? { status: query.status } : {}),
      ...(query.reason ? { reason: query.reason } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.orderIssue.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: issueInclude,
      }),
      this.prisma.orderIssue.count({ where }),
    ]);

    return {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findAllAdmin(query: QueryOrderIssueDto) {
    const { page = 1, limit = 20 } = query;
    const where: Prisma.OrderIssueWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.reason ? { reason: query.reason } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.orderIssue.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: issueInclude,
      }),
      this.prisma.orderIssue.count({ where }),
    ]);

    return {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(issueId: string, userId: string, isAdmin: boolean) {
    const issue = await this.prisma.orderIssue.findUnique({
      where: { id: issueId },
      include: issueInclude,
    });
    if (!issue) {
      throw new NotFoundException("Không tìm thấy yêu cầu xử lý");
    }
    if (!isAdmin && issue.userId !== userId) {
      throw new ForbiddenException("Bạn không có quyền xem yêu cầu này");
    }
    return issue;
  }

  async review(issueId: string, adminId: string, dto: ReviewOrderIssueDto) {
    const issue = await this.prisma.orderIssue.findUnique({
      where: { id: issueId },
      include: { order: { select: { id: true, orderCode: true } } },
    });
    if (!issue) {
      throw new NotFoundException("Không tìm thấy yêu cầu xử lý");
    }
    if (issue.status !== OrderIssueStatus.PENDING) {
      throw new BadRequestException(
        "Yêu cầu này đã được xử lý, không thể duyệt lại",
      );
    }

    if (dto.decision === "REJECT") {
      if (!dto.adminNote?.trim()) {
        throw new BadRequestException(
          "Từ chối yêu cầu cần kèm lý do (adminNote)",
        );
      }
      const rejected = await this.prisma.orderIssue.update({
        where: { id: issue.id },
        data: {
          status: OrderIssueStatus.REJECTED,
          adminNote: dto.adminNote,
          adminId,
        },
        include: issueInclude,
      });
      await this.logIssueEvent(
        issue.orderId,
        issue.id,
        "ORDER_ISSUE_REJECTED",
        adminId,
        "Yêu cầu xử lý lỗi đơn hàng đã bị từ chối.",
        "review",
      );
      await this.notifyUserReviewed(rejected.userId, rejected.id, false).catch(
        () => undefined,
      );
      return rejected;
    }

    if (!dto.approvedResolution) {
      throw new BadRequestException(
        "Duyệt yêu cầu cần chọn hướng xử lý (approvedResolution)",
      );
    }

    if (dto.approvedResolution === OrderIssueResolution.REFUND) {
      // Chuyển issue sang RESOLVED trước, rồi mới gọi sang luồng refund có sẵn
      // (ordersService.updateRefund tự mở transaction riêng, không thể lồng chung
      // transaction với orderIssue.update). Nếu updateRefund thất bại (validation
      // hoặc lỗi tạm thời), rollback issue về PENDING để tránh lệch trạng thái
      // (Order đã REQUIRED refund nhưng issue vẫn kẹt PENDING).
      const resolved = await this.prisma.orderIssue.update({
        where: { id: issue.id },
        data: {
          status: OrderIssueStatus.RESOLVED,
          approvedResolution: OrderIssueResolution.REFUND,
          adminNote: dto.adminNote,
          adminId,
        },
        include: issueInclude,
      });

      try {
        // Tái dùng luồng refund có sẵn: tạo Refund MANUAL + chuyển Order.refundStatus
        // sang REQUIRED, không tự ghi đè Payment/Order.amountRefundedVnd.
        await this.ordersService.updateRefund(
          issue.orderId,
          {
            refundStatus: RefundStatus.REQUIRED,
            internalNote: `Duyệt hoàn tiền cho issue ${issue.id} (item ${issue.orderItemId})${dto.adminNote ? `: ${dto.adminNote}` : ""}`,
          },
          adminId,
        );
      } catch (err) {
        await this.prisma.orderIssue.update({
          where: { id: issue.id },
          data: {
            status: OrderIssueStatus.PENDING,
            approvedResolution: null,
            adminNote: issue.adminNote,
            adminId: issue.adminId,
          },
        });
        throw err;
      }

      await this.logIssueEvent(
        issue.orderId,
        issue.id,
        "ORDER_ISSUE_REFUND_APPROVED",
        adminId,
        "Yêu cầu xử lý lỗi đơn hàng đã được duyệt hoàn tiền.",
        "review",
      );
      await this.notifyUserReviewed(resolved.userId, resolved.id, true).catch(
        () => undefined,
      );
      return resolved;
    }

    // Hướng EXCHANGE: sprint này chỉ track trạng thái, admin ship thủ công rồi
    // đánh dấu hoàn tất qua endpoint resolve.
    const approved = await this.prisma.orderIssue.update({
      where: { id: issue.id },
      data: {
        status: OrderIssueStatus.APPROVED,
        approvedResolution: OrderIssueResolution.EXCHANGE,
        adminNote: dto.adminNote,
        adminId,
      },
      include: issueInclude,
    });
    await this.logIssueEvent(
      issue.orderId,
      issue.id,
      "ORDER_ISSUE_EXCHANGE_APPROVED",
      adminId,
      "Yêu cầu xử lý lỗi đơn hàng đã được duyệt đổi hàng 1-1.",
      "review",
    );
    await this.notifyUserReviewed(approved.userId, approved.id, true).catch(
      () => undefined,
    );
    return approved;
  }

  async resolve(issueId: string, dto: ResolveOrderIssueDto) {
    const issue = await this.prisma.orderIssue.findUnique({
      where: { id: issueId },
    });
    if (!issue) {
      throw new NotFoundException("Không tìm thấy yêu cầu xử lý");
    }
    if (issue.status !== OrderIssueStatus.APPROVED) {
      throw new BadRequestException(
        "Chỉ có thể hoàn tất yêu cầu đổi hàng đang chờ xử lý",
      );
    }

    const resolved = await this.prisma.orderIssue.update({
      where: { id: issue.id },
      data: {
        status: OrderIssueStatus.RESOLVED,
        ...(dto.note ? { adminNote: dto.note } : {}),
      },
      include: issueInclude,
    });
    await this.logIssueEvent(
      issue.orderId,
      issue.id,
      "ORDER_ISSUE_EXCHANGE_RESOLVED",
      undefined,
      "Yêu cầu đổi hàng đã được xử lý xong.",
      "resolve",
    );
    await this.notifyUserResolved(resolved.userId, resolved.id).catch(
      () => undefined,
    );
    return resolved;
  }

  // Ghi OrderEvent lên timeline đơn hàng gốc để FE order detail thấy mốc xử lý
  // issue. deduplicationKey theo (issueId, stage) để tránh double-click tạo
  // nhiều event trùng cho cùng 1 bước xử lý.
  private async logIssueEvent(
    orderId: string,
    issueId: string,
    type: string,
    actorId: string | undefined,
    publicMessage: string,
    stage: string,
  ) {
    await this.prisma.orderEvent
      .create({
        data: {
          orderId,
          type,
          source: "ADMIN",
          actorId,
          publicMessage,
          deduplicationKey: `order-issue:${issueId}:${stage}`,
          metadata: { issueId },
        },
      })
      .catch((err) => {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          return null;
        }
        throw err;
      });
  }

  private async assertWithinIssueWindow(orderId: string, fallback: Date) {
    const completedEvent = await this.prisma.orderEvent.findFirst({
      where: { orderId, toStatus: OrderStatus.COMPLETED },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true },
    });
    const completedAt = completedEvent?.occurredAt ?? fallback;
    if (Date.now() - completedAt.getTime() > ISSUE_WINDOW_MS) {
      throw new BadRequestException(
        "Đã quá 7 ngày kể từ khi đơn hàng hoàn tất, không thể báo lỗi",
      );
    }
  }

  private async findOrderForOwner(userId: string, identifier: string) {
    const where = this.resolveOrderWhere(identifier);
    if (!where) {
      throw new NotFoundException(
        `Không tìm thấy đơn hàng có ID ${identifier}`,
      );
    }
    const order = await this.prisma.order.findFirst({
      where: { ...where, userId },
      select: { id: true, orderCode: true, status: true, updatedAt: true },
    });
    if (!order) {
      throw new NotFoundException(
        `Không tìm thấy đơn hàng có ID ${identifier}`,
      );
    }
    return order;
  }

  private async findOrderByIdentifier(identifier: string) {
    const where = this.resolveOrderWhere(identifier);
    if (!where) return null;
    return this.prisma.order.findFirst({
      where,
      select: { id: true, orderCode: true, status: true, updatedAt: true },
    });
  }

  private resolveOrderWhere(identifier: string): Prisma.OrderWhereInput | null {
    const value = identifier.trim();
    if (UUID_REGEX.test(value)) {
      return { id: value };
    }
    const numeric = Number(value.replace(/^ORD-/i, ""));
    if (Number.isInteger(numeric) && numeric > 0 && numeric <= MAX_INT4) {
      return { orderCode: numeric };
    }
    return null;
  }

  private async notifyAdminsNewIssue(issueId: string, orderCode: number) {
    const admins = await this.prisma.user.findMany({
      where: { role: Role.ADMIN },
      select: { id: true },
    });
    for (const admin of admins) {
      await this.notificationService.create({
        userId: admin.id,
        type: NotificationType.ORDER_ISSUE,
        title: "Báo lỗi đơn hàng mới",
        message: `Đơn #${orderCode} vừa có yêu cầu xử lý lỗi mới`,
        data: { issueId, orderCode, type: "NEW_ORDER_ISSUE" },
      });
    }
  }

  private async notifyUserReviewed(
    userId: string,
    issueId: string,
    approved: boolean,
  ) {
    await this.notificationService.create({
      userId,
      type: NotificationType.ORDER_ISSUE,
      title: approved ? "Yêu cầu xử lý được duyệt" : "Yêu cầu xử lý bị từ chối",
      message: approved
        ? "Yêu cầu báo lỗi của bạn đã được duyệt, shop sẽ liên hệ để xử lý tiếp"
        : "Yêu cầu báo lỗi của bạn chưa được chấp nhận, vui lòng xem ghi chú từ shop",
      data: { issueId, type: "ORDER_ISSUE_REVIEWED" },
    });
  }

  private async notifyUserResolved(userId: string, issueId: string) {
    await this.notificationService.create({
      userId,
      type: NotificationType.ORDER_ISSUE,
      title: "Xử lý đổi hàng hoàn tất",
      message: "Yêu cầu đổi hàng của bạn đã được xử lý xong",
      data: { issueId, type: "ORDER_ISSUE_RESOLVED" },
    });
  }
}
