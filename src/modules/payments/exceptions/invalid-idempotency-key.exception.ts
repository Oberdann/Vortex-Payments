import { HttpStatus } from "@nestjs/common";
import { BaseVortexCommerceException } from "src/common/exceptions/base-vortex-commerce-exception";

export class InvalidIdempotencyKeyException extends BaseVortexCommerceException {
  constructor() {
    super(
      "Envie um X-Idempotency-Key válido com até 64 caracteres.",
      HttpStatus.BAD_REQUEST,
    );
  }
}
