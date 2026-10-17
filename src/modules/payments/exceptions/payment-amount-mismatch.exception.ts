import { HttpStatus } from "@nestjs/common";
import { BaseVortexCommerceException } from "src/common/exceptions/base-vortex-commerce-exception";

export class PaymentAmountMismatchException extends BaseVortexCommerceException {
  constructor(orderId: string) {
    super(
      `Já existe um pagamento para o pedido ${orderId} com outro valor.`,
      HttpStatus.CONFLICT,
    );
  }
}
