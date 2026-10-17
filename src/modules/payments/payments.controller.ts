import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { ApiHeader, ApiTags } from "@nestjs/swagger";
import { PaymentsService } from "./payments.service";
import { CreatePaymentDto } from "./dtos/create-payment.dto";

@Controller("payments")
@ApiTags("payments")
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get("health")
  getHealth() {
    return this.paymentsService.getHealth();
  }

  @Get("order/:orderId")
  getByOrderId(@Param("orderId") orderId: string) {
    return this.paymentsService.getByOrderId(orderId);
  }

  @Post()
  @HttpCode(201)
  @ApiHeader({
    name: "X-Idempotency-Key",
    required: true,
    description:
      "UUID único da tentativa; use a mesma chave ao repetir a requisição.",
  })
  create(
    @Body() input: CreatePaymentDto,
    @Headers("x-idempotency-key") idempotencyKey: string | undefined,
  ) {
    return this.paymentsService.create(input, idempotencyKey);
  }

  @Get(":id")
  getById(@Param("id") id: string) {
    return this.paymentsService.getById(id);
  }

  @Post("webhooks/mercado-pago")
  @HttpCode(200)
  processMercadoPagoWebhook(
    @Query("type") type: string | undefined,
    @Query("data.id") dataId: string | undefined,
    @Headers("x-signature") signatureHeader: string | undefined,
    @Headers("x-request-id") requestId: string | undefined,
  ) {
    return this.paymentsService.processMercadoPagoWebhook({
      type,
      dataId,
      signatureHeader,
      requestId,
    });
  }
}
