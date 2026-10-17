import { Injectable } from "@nestjs/common";
import { PaymentAttempt, Payment, Prisma } from "generated/prisma/client";
import { PaymentStatus } from "generated/prisma/enums";
import { PrismaService } from "src/database/prisma.service";
import {
  PAYMENT_CREATION_REQUESTED_EVENT,
  PAYMENT_READY_EVENT,
  PAYMENT_STATUS_CHANGED_EVENT,
} from "src/common/messaging/rabbitmq-topology";
import { CreatePaymentDto } from "./dtos/create-payment.dto";
import { InvalidIdempotencyKeyException } from "./exceptions/invalid-idempotency-key.exception";
import { InvalidMercadoPagoWebhookSignatureException } from "./exceptions/invalid-mercado-pago-webhook-signature.exception";
import { InvalidPaymentAmountException } from "./exceptions/invalid-payment-amount.exception";
import { MercadoPagoGateway } from "./mercado-pago.gateway";
import { PaymentAmountMismatchException } from "./exceptions/payment-amount-mismatch.exception";
import { PaymentAttemptInProgressException } from "./exceptions/payment-attempt-in-progress.exception";
import { PaymentNotFoundException } from "./exceptions/payment-not-found.exception";
import { PaymentNotRetryableException } from "./exceptions/payment-not-retryable.exception";

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TERMINAL_PAYMENT_STATUSES = new Set<PaymentStatus>([
  PaymentStatus.APPROVED,
  PaymentStatus.REJECTED,
  PaymentStatus.CANCELLED,
  PaymentStatus.REFUNDED,
  PaymentStatus.CHARGED_BACK,
]);

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mercadoPago: MercadoPagoGateway,
  ) {}

  getHealth() {
    return { service: "payments", status: "ok" };
  }

  async getById(id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: { attempts: { orderBy: { createdAt: "desc" }, take: 1 } },
    });

    if (!payment) {
      throw new PaymentNotFoundException(id);
    }

    return this.toPaymentResponse(payment, payment.attempts[0]);
  }

  async getByOrderId(orderId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { orderId },
      include: { attempts: { orderBy: { createdAt: "desc" }, take: 1 } },
    });

    if (!payment) {
      throw new PaymentNotFoundException(orderId);
    }

    return this.toPaymentResponse(payment, payment.attempts[0]);
  }

  async handlePaymentCreationRequested(
    eventId: string,
    input: {
      orderId: string;
      amount: string;
    },
  ) {
    if (!/^\d+(\.\d{1,2})?$/.test(input.amount)) {
      throw new InvalidPaymentAmountException();
    }

    const amount = new Prisma.Decimal(input.amount);

    if (amount.lessThanOrEqualTo(0)) {
      throw new InvalidPaymentAmountException();
    }

    await this.prisma.$transaction(async (transaction) => {
      const processedEvent = await transaction.inboxEvent.findUnique({
        where: { eventId },
      });

      if (processedEvent) {
        return;
      }

      const existing = await transaction.payment.findUnique({
        where: { orderId: input.orderId },
      });

      if (existing && !existing.amount.equals(amount)) {
        throw new PaymentAmountMismatchException(input.orderId);
      }

      const payment =
        existing ??
        (await transaction.payment.create({
          data: { orderId: input.orderId, amount },
        }));

      await transaction.inboxEvent.create({
        data: {
          eventId,
          eventType: PAYMENT_CREATION_REQUESTED_EVENT,
          aggregateId: input.orderId,
        },
      });

      await transaction.outboxEvent.create({
        data: {
          aggregateId: input.orderId,
          eventType: PAYMENT_READY_EVENT,
          payload: {
            orderId: input.orderId,
            paymentId: payment.id,
            amount: payment.amount.toString(),
          },
        },
      });
    });
  }

  async create(input: CreatePaymentDto, idempotencyKey: string | undefined) {
    if (
      !idempotencyKey ||
      idempotencyKey.length > 64 ||
      !UUID_V4_PATTERN.test(idempotencyKey)
    ) {
      throw new InvalidIdempotencyKeyException();
    }

    const payment = await this.prisma.payment.findUnique({
      where: { orderId: input.orderId },
      include: { attempts: { orderBy: { createdAt: "desc" }, take: 1 } },
    });

    if (!payment) {
      throw new PaymentNotFoundException(input.orderId);
    }

    const priorAttempt = await this.prisma.paymentAttempt.findUnique({
      where: { idempotencyKey },
    });

    if (priorAttempt && priorAttempt.paymentId !== payment.id) {
      throw new InvalidIdempotencyKeyException();
    }

    if (priorAttempt?.providerPaymentId) {
      return this.toPaymentResponse(payment, priorAttempt);
    }

    if (payment.status === PaymentStatus.APPROVED) {
      return this.toPaymentResponse(payment, payment.attempts[0]);
    }

    if (
      payment.status === PaymentStatus.REFUNDED ||
      payment.status === PaymentStatus.CHARGED_BACK
    ) {
      throw new PaymentNotRetryableException(input.orderId);
    }

    let attempt: PaymentAttempt;

    try {
      attempt = await this.prisma.$transaction(
        async (transaction) => {
          const existingAttempt = await transaction.paymentAttempt.findUnique({
            where: { idempotencyKey },
          });

          if (existingAttempt) {
            if (existingAttempt.paymentId !== payment.id) {
              throw new InvalidIdempotencyKeyException();
            }

            return existingAttempt;
          }

          const currentPayment = await transaction.payment.findUniqueOrThrow({
            where: { id: payment.id },
          });

          const currentAttempt = currentPayment.currentAttemptId
            ? await transaction.paymentAttempt.findUnique({
                where: { id: currentPayment.currentAttemptId },
              })
            : null;

          if (
            currentAttempt?.status === PaymentStatus.PENDING &&
            currentAttempt.idempotencyKey !== idempotencyKey
          ) {
            throw new PaymentAttemptInProgressException(input.orderId);
          }

          const createdAttempt = await transaction.paymentAttempt.create({
            data: {
              paymentId: payment.id,
              idempotencyKey,
              amount: payment.amount,
              status: PaymentStatus.PENDING,
            },
          });

          await transaction.payment.update({
            where: { id: payment.id },
            data: {
              currentAttemptId: createdAttempt.id,
              status: PaymentStatus.PENDING,
              providerPaymentId: null,
            },
          });

          if (currentPayment.status !== PaymentStatus.PENDING) {
            await transaction.outboxEvent.create({
              data: {
                aggregateId: payment.orderId,
                eventType: PAYMENT_STATUS_CHANGED_EVENT,
                payload: {
                  orderId: payment.orderId,
                  paymentId: payment.id,
                  status: PaymentStatus.PENDING,
                },
              },
            });
          }

          return createdAttempt;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        !this.isUniqueConstraintError(error) &&
        !this.isSerializationError(error)
      ) {
        throw error;
      }

      const existingAttempt = await this.prisma.paymentAttempt.findUnique({
        where: { idempotencyKey },
      });

      if (!existingAttempt || existingAttempt.paymentId !== payment.id) {
        if (this.isSerializationError(error)) {
          throw new PaymentAttemptInProgressException(input.orderId);
        }

        throw error;
      }

      attempt = existingAttempt;
    }

    if (attempt.providerPaymentId) {
      return this.toPaymentResponse(payment, attempt);
    }

    const providerPayment = await this.mercadoPago.createPayment({
      paymentId: payment.id,
      attemptId: attempt.id,
      orderId: payment.orderId,
      amount: payment.amount.toNumber(),
      idempotencyKey,
      token: input.token,
      paymentMethodId: input.paymentMethodId,
      installments: input.installments,
      issuerId: input.issuerId,
      payer: input.payer,
    });

    const nextStatus = this.mapProviderStatus(providerPayment.status);

    const result = await this.prisma.$transaction(async (transaction) => {
      const persistedAttempt =
        await transaction.paymentAttempt.findUniqueOrThrow({
          where: { id: attempt.id },
        });

      const resolvedStatus = this.resolveAttemptStatus(
        persistedAttempt.status,
        nextStatus,
      );

      const updatedAttempt = await transaction.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          providerPaymentId:
            persistedAttempt.providerPaymentId ?? String(providerPayment.id),
          status: resolvedStatus,
        },
      });

      const currentPayment = await transaction.payment.findUniqueOrThrow({
        where: { id: payment.id },
      });

      if (currentPayment.currentAttemptId === attempt.id) {
        await transaction.payment.update({
          where: { id: payment.id },
          data: {
            providerPaymentId:
              persistedAttempt.providerPaymentId ?? String(providerPayment.id),
            status: resolvedStatus,
          },
        });

        if (currentPayment.status !== resolvedStatus) {
          await transaction.outboxEvent.create({
            data: {
              aggregateId: payment.orderId,
              eventType: PAYMENT_STATUS_CHANGED_EVENT,
              payload: {
                orderId: payment.orderId,
                paymentId: payment.id,
                status: resolvedStatus,
              },
            },
          });
        }
      }

      return updatedAttempt;
    });

    const current = await this.prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });

    return this.toPaymentResponse(current, result);
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

    const amount = new Prisma.Decimal(providerPayment.transaction_amount);

    if (!payment.amount.equals(amount)) {
      throw new PaymentAmountMismatchException(payment.orderId);
    }

    const attempt = await this.findWebhookAttempt(providerPayment);

    if (!attempt || attempt.paymentId !== payment.id) {
      throw new PaymentNotFoundException(String(providerPayment.id));
    }

    if (!attempt.amount.equals(amount)) {
      throw new PaymentAmountMismatchException(payment.orderId);
    }

    const nextStatus = this.mapProviderStatus(providerPayment.status);

    const updated = await this.prisma.$transaction(async (transaction) => {
      const persistedAttempt =
        await transaction.paymentAttempt.findUniqueOrThrow({
          where: { id: attempt.id },
        });

      const resolvedStatus = this.resolveAttemptStatus(
        persistedAttempt.status,
        nextStatus,
      );

      const updatedAttempt = await transaction.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          providerPaymentId:
            persistedAttempt.providerPaymentId ?? String(providerPayment.id),
          status: resolvedStatus,
        },
      });

      const currentPayment = await transaction.payment.findUniqueOrThrow({
        where: { id: payment.id },
      });

      if (
        currentPayment.currentAttemptId === attempt.id &&
        currentPayment.status !== resolvedStatus
      ) {
        await transaction.payment.update({
          where: { id: payment.id },
          data: {
            providerPaymentId:
              persistedAttempt.providerPaymentId ?? String(providerPayment.id),
            status: resolvedStatus,
          },
        });

        await transaction.outboxEvent.create({
          data: {
            aggregateId: payment.orderId,
            eventType: PAYMENT_STATUS_CHANGED_EVENT,
            payload: {
              orderId: payment.orderId,
              paymentId: payment.id,
              status: resolvedStatus,
            },
          },
        });
      }

      return updatedAttempt;
    });

    const currentPayment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });

    return this.toPaymentResponse(currentPayment, updated);
  }

  private async findWebhookAttempt(providerPayment: {
    id: number | string;
    metadata?: Record<string, unknown>;
  }) {
    const byProviderId = await this.prisma.paymentAttempt.findUnique({
      where: { providerPaymentId: String(providerPayment.id) },
    });

    if (byProviderId) {
      return byProviderId;
    }

    const metadataAttemptId =
      providerPayment.metadata?.vortex_payment_attempt_id;

    if (typeof metadataAttemptId === "string") {
      const byMetadata = await this.prisma.paymentAttempt.findUnique({
        where: { id: metadataAttemptId },
      });
      
      if (byMetadata) {
        return byMetadata;
      }
    }

    return null;
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

  private resolveAttemptStatus(
    currentStatus: PaymentStatus,
    incomingStatus: PaymentStatus,
  ): PaymentStatus {
    return TERMINAL_PAYMENT_STATUSES.has(currentStatus)
      ? currentStatus
      : incomingStatus;
  }

  private toPaymentResponse(
    payment: Pick<
      Payment,
      | "id"
      | "orderId"
      | "amount"
      | "status"
      | "providerPaymentId"
      | "currentAttemptId"
      | "createdAt"
      | "updatedAt"
    >,
    attempt?: Pick<
      PaymentAttempt,
      "id" | "status" | "providerPaymentId" | "createdAt"
    >,
  ) {
    const attemptIsCurrent =
      attempt !== undefined && payment.currentAttemptId === attempt.id;

    return {
      id: payment.id,
      orderId: payment.orderId,
      amount: payment.amount.toString(),
      status: attempt && !attemptIsCurrent ? attempt.status : payment.status,
      providerPaymentId:
        attempt && !attemptIsCurrent
          ? attempt.providerPaymentId
          : payment.providerPaymentId,
      currentAttempt: attempt
        ? {
            id: attempt.id,
            status: attempt.status,
            providerPaymentId: attempt.providerPaymentId,
            createdAt: attempt.createdAt,
          }
        : null,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    );
  }

  private isSerializationError(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2034"
    );
  }
}
