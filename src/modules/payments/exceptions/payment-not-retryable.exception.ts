import { HttpStatus } from "@nestjs/common";
import { BaseVortexCommerceException } from "src/common/exceptions/base-vortex-commerce-exception";

export class PaymentNotRetryableException extends BaseVortexCommerceException {
  constructor(orderId: string) {
    super(
      `O pagamento do pedido ${orderId} não pode receber uma nova tentativa.`,
      HttpStatus.CONFLICT,
    );
  }
}
