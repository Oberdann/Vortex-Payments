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
import { PaymentsService } from "./payments.service";
import { CreatePaymentDto } from "./dtos/create-payment.dto";

@Controller("payments")
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
  create(@Body() input: CreatePaymentDto) {
    return this.paymentsService.create(input);
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
