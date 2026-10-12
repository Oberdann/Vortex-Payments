import { Module } from "@nestjs/common";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { DatabaseModule } from "src/database/prisma.module";
import { MercadoPagoGateway } from "./mercado-pago.gateway";
import { PaymentCreationRequestsConsumer } from "./consumers/payment-creation-requests.consumer";
import { OutboxPublisherService } from "./producers/outbox-publisher.service";

@Module({
  imports: [DatabaseModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    MercadoPagoGateway,
    PaymentCreationRequestsConsumer,
    OutboxPublisherService,
  ],
})
export class PaymentsModule {}
