import { HttpStatus } from "@nestjs/common";
import { BaseVortexCommerceException } from "src/common/exceptions/base-vortex-commerce-exception";

export class InvalidMercadoPagoWebhookSignatureException extends BaseVortexCommerceException {
  constructor() {
    super(
      "Assinatura da notificação do Mercado Pago inválida.",
      HttpStatus.UNAUTHORIZED,
    );
  }
}
