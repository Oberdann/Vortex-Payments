import { HttpStatus } from "@nestjs/common";
import { BaseVortexCommerceException } from "src/common/exceptions/base-vortex-commerce-exception";

export class PaymentAttemptInProgressException extends BaseVortexCommerceException {
  constructor(orderId: string) {
    super(
      `O pagamento do pedido ${orderId} já possui uma tentativa em processamento.`,
      HttpStatus.CONFLICT,
    );
  }
}
