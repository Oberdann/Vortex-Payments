import { HttpStatus } from '@nestjs/common';
import { BaseVortexCommerceException } from 'src/common/exceptions/base-vortex-commerce-exception';

export class PaymentNotFoundException extends BaseVortexCommerceException {
  constructor(id: string) {
    super(`Pagamento com ID ${id} não encontrado.`, HttpStatus.NOT_FOUND);
  }
}
