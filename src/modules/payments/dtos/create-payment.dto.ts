import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, Matches } from 'class-validator';

export class CreatePaymentDto {
  @ApiProperty({ example: 'b7e2f3a1-9876-4c2d-9f0a-abcdef123456' })
  @IsUUID('4')
  orderId: string;

  @ApiProperty({ example: '149.90', description: 'Valor do pedido em BRL.' })
  @Matches(/^\d+(\.\d{1,2})?$/)
  amount: string;
}
