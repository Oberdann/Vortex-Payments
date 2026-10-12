import { Injectable } from "@nestjs/common";
import { Prisma } from "generated/prisma/client";
import { PaymentStatus } from "generated/prisma/enums";
import { PrismaService } from "src/database/prisma.service";
import { InvalidPaymentAmountException } from "./exceptions/invalid-payment-amount.exception";
import { MercadoPagoGateway } from "./mercado-pago.gateway";
import { PaymentAmountMismatchException } from "./exceptions/payment-amount-mismatch.exception";
import { PaymentNotFoundException } from "./exceptions/payment-not-found.exception";
import { InvalidMercadoPagoWebhookSignatureException } from "./exceptions/invalid-mercado-pago-webhook-signature.exception";
import {
  PAYMENT_CREATION_SUCCEEDED_EVENT,
  PAYMENT_STATUS_CHANGED_EVENT,
} from "src/common/messaging/rabbitmq-topology";

export interface CreatePaymentInput {
  orderId: string;
  amount: string;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mercadoPago: MercadoPagoGateway,
  ) {}

  getHealth() {
    return {
      service: "payments",
      status: "ok",
    };
  }

  async create(input: CreatePaymentInput) {
    if (!/^\d+(\.\d{1,2})?$/.test(input.amount)) {
      throw new InvalidPaymentAmountException();
    }

    const amount = new Prisma.Decimal(input.amount);

    if (amount.lessThanOrEqualTo(0)) {
      throw new InvalidPaymentAmountException();
    }

    const payment = await this.prisma.payment.upsert({
      where: { orderId: input.orderId },
      create: {
        orderId: input.orderId,
        amount,
      },
      update: {},
    });

    if (!payment.amount.equals(amount)) {
      throw new PaymentAmountMismatchException(input.orderId);
    }

    if (payment.providerPreferenceId && payment.checkoutUrl) {
      return this.toPaymentResponse(payment);
    }

    const preference = await this.mercadoPago.createCheckoutPreference({
      paymentId: payment.id,
      orderId: payment.orderId,
      amount: payment.amount.toNumber(),
    });

    const updatedPayment = await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        providerPreferenceId: preference.id,
        checkoutUrl: preference.checkoutUrl,
      },
    });

    return this.toPaymentResponse(updatedPayment);
  }

  async getById(id: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id } });

    if (!payment) {
      throw new PaymentNotFoundException(id);
    }

    return this.toPaymentResponse(payment);
  }

  async getByOrderId(orderId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { orderId },
    });
    if (!payment) throw new PaymentNotFoundException(orderId);
    return this.toPaymentResponse(payment);
  }

  async handlePaymentCreationRequested(
    eventId: string,
    input: CreatePaymentInput,
  ) {
    const existing = await this.prisma.inboxEvent.findUnique({
      where: { eventId },
    });
    if (existing) return;

    const payment = await this.create(input);
    await this.prisma.$transaction(async (transaction) => {
      if (await transaction.inboxEvent.findUnique({ where: { eventId } }))
        return;
      await transaction.inboxEvent.create({
        data: {
          eventId,
          eventType: "payment.creation.requested",
          aggregateId: input.orderId,
        },
      });
      await transaction.outboxEvent.create({
        data: {
          aggregateId: input.orderId,
          eventType: PAYMENT_CREATION_SUCCEEDED_EVENT,
          payload: {
            orderId: input.orderId,
            paymentId: payment.id,
            amount: payment.amount,
          },
        },
      });
    });
  }

  async processMercadoPagoWebhook(input: {
    type: string | undefined;
    dataId: string | undefined;
    signatureHeader: string | undefined;
    requestId: string | undefined;
  }) {
    if (input.type !== "payment") {
      return { received: true, ignored: true };
    }

    const validSignature = this.mercadoPago.isValidWebhookSignature(input);
    if (!validSignature || !input.dataId) {
      throw new InvalidMercadoPagoWebhookSignatureException();
    }

    const providerPayment = await this.mercadoPago.getPayment(input.dataId);
    const payment = await this.prisma.payment.findUnique({
      where: { orderId: providerPayment.external_reference },
    });

    if (!payment) {
      throw new PaymentNotFoundException(providerPayment.external_reference);
    }

    const providerAmount = new Prisma.Decimal(
      providerPayment.transaction_amount,
    );
    if (!payment.amount.equals(providerAmount)) {
      throw new PaymentAmountMismatchException(payment.orderId);
    }

    const nextStatus = this.mapProviderStatus(providerPayment.status);
    const updatedPayment = await this.prisma.$transaction(
      async (transaction) => {
        const updated = await transaction.payment.update({
          where: { id: payment.id },
          data: {
            providerPaymentId: String(providerPayment.id),
            status: nextStatus,
          },
        });
        if (payment.status !== nextStatus) {
          await transaction.outboxEvent.create({
            data: {
              aggregateId: payment.orderId,
              eventType: PAYMENT_STATUS_CHANGED_EVENT,
              payload: {
                orderId: payment.orderId,
                paymentId: payment.id,
                status: nextStatus,
              },
            },
          });
        }
        return updated;
      },
    );

    return this.toPaymentResponse(updatedPayment);
  }

  private mapProviderStatus(status: string): PaymentStatus {
    switch (status) {
      case "approved":
        return PaymentStatus.APPROVED;
      case "rejected":
        return PaymentStatus.REJECTED;
      case "cancelled":
        return PaymentStatus.CANCELLED;
      case "refunded":
        return PaymentStatus.REFUNDED;
      case "charged_back":
        return PaymentStatus.CHARGED_BACK;
      default:
        return PaymentStatus.PENDING;
    }
  }

  private toPaymentResponse(payment: {
    id: string;
    orderId: string;
    amount: Prisma.Decimal;
    status: string;
    providerPreferenceId: string | null;
    checkoutUrl: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: payment.id,
      orderId: payment.orderId,
      amount: payment.amount.toString(),
      status: payment.status,
      providerPreferenceId: payment.providerPreferenceId,
      checkoutUrl: payment.checkoutUrl,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
  }
}
