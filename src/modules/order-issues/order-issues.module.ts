import { Module } from "@nestjs/common";
import { NotificationModule } from "../notification/notification.module";
import { OrdersModule } from "../orders/orders.module";
import { AdminOrderIssuesController } from "./admin-order-issues.controller";
import { OrderIssuesController } from "./order-issues.controller";
import { OrderIssuesService } from "./order-issues.service";

@Module({
  imports: [NotificationModule, OrdersModule],
  controllers: [OrderIssuesController, AdminOrderIssuesController],
  providers: [OrderIssuesService],
})
export class OrderIssuesModule {}
