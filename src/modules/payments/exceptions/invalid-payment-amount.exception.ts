import { HttpStatus } from '@nestjs/common';
import { BaseVortexCommerceException } from 'src/common/exceptions/base-vortex-commerce-exception';

export class InvalidPaymentAmountException extends BaseVortexCommerceException {
  constructor() {
    super(
      'O valor do pagamento deve ser válido e maior que zero.',
      HttpStatus.BAD_REQUEST,
    );
  }
}
