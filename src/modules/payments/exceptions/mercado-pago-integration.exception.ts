import { HttpStatus } from "@nestjs/common";
import { BaseVortexCommerceException } from "src/common/exceptions/base-vortex-commerce-exception";

export class MercadoPagoIntegrationException extends BaseVortexCommerceException {
  constructor(message: string, statusCode = HttpStatus.BAD_GATEWAY) {
    super(message, statusCode);
  }
}
