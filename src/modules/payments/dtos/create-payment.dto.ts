import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export class PayerIdentificationDto {
  @ApiProperty({ example: "CPF" })
  @IsString()
  @MinLength(2)
  type: string;

  @ApiProperty({ example: "12345678909" })
  @IsString()
  @MinLength(1)
  number: string;
}

export class PaymentPayerDto {
  @ApiProperty({ example: "comprador@teste.com" })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ type: PayerIdentificationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PayerIdentificationDto)
  identification?: PayerIdentificationDto;
}

export class CreatePaymentDto {
  @ApiProperty({ example: "b7e2f3a1-9876-4c2d-9f0a-abcdef123456" })
  @IsUUID("4")
  orderId: string;

  @ApiProperty({ description: "Token de cartão gerado pelo MercadoPago.js." })
  @IsString()
  @MinLength(1)
  token: string;

  @ApiProperty({ example: "visa" })
  @IsString()
  @MinLength(1)
  paymentMethodId: string;

  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  installments: number;

  @ApiPropertyOptional({ example: "123456789" })
  @IsOptional()
  @IsString()
  issuerId?: string;

  @ApiProperty({ type: PaymentPayerDto })
  @ValidateNested()
  @Type(() => PaymentPayerDto)
  payer: PaymentPayerDto;
}
