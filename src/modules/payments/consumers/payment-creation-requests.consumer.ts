import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import * as amqp from "amqplib";
import { ConfirmChannel, ConsumeMessage } from "amqplib";
import { PinoLogger } from "nestjs-pino";
import { PaymentsService } from "../payments.service";
import {
  MAX_PROCESSING_RETRIES,
  PAYMENT_CREATION_REQUESTED_EVENT,
  PAYMENTS_CREATION_REQUESTS_DLQ,
  PAYMENTS_CREATION_REQUESTS_FAILED_ROUTE,
  PAYMENTS_CREATION_REQUESTS_QUEUE,
  PAYMENTS_CREATION_REQUESTS_RETRY_QUEUE,
  RABBITMQ_EVENTS_EXCHANGE,
  RETRY_DELAY_MS,
} from "src/common/messaging/rabbitmq-topology";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DLX = "vortex.events.dlx";

interface PaymentCreationRequestedEvent {
  eventId: string;
  eventType: string;
  data: {
    orderId: string;
    amount: string;
  };
}

function isPaymentCreationRequestedEvent(
  value: unknown,
): value is PaymentCreationRequestedEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const event = value as Record<string, unknown>;
  const data = event.data;

  if (typeof data !== "object" || data === null) {
    return false;
  }

  const paymentData = data as Record<string, unknown>;

  return (
    typeof event.eventId === "string" &&
    UUID.test(event.eventId) &&
    event.eventType === PAYMENT_CREATION_REQUESTED_EVENT &&
    typeof paymentData.orderId === "string" &&
    UUID.test(paymentData.orderId) &&
    typeof paymentData.amount === "string" &&
    /^\d+(\.\d{1,2})?$/.test(paymentData.amount)
  );
}

@Injectable()
export class PaymentCreationRequestsConsumer
  implements OnModuleInit, OnModuleDestroy
{
  private connection?: amqp.ChannelModel;
  private channel?: ConfirmChannel;
  private consumerTag?: string;
  private reconnectTimer?: NodeJS.Timeout;
  private stopping = false;

  constructor(
    private readonly payments: PaymentsService,
    private readonly logger: PinoLogger,
  ) {}

  onModuleInit() {
    void this.connect();
  }

  async onModuleDestroy() {
    this.stopping = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    if (this.consumerTag) {
      await this.channel?.cancel(this.consumerTag).catch(() => undefined);
    }

    await this.connection?.close().catch(() => undefined);
  }

  private async connect() {
    if (this.stopping || this.connection) {
      return;
    }

    const url = process.env.RABBITMQ_URL;

    if (!url) {
      this.logger.error(
        "RABBITMQ_URL não foi configurada no Payments Service.",
      );
      return this.reconnect();
    }
    try {
      this.connection = await amqp.connect(url);
      this.connection.on("error", () => undefined);
      this.connection.on("close", () => {
        this.connection = undefined;
        this.channel = undefined;
        this.consumerTag = undefined;
        this.reconnect();
      });
      this.channel = await this.connection.createConfirmChannel();
      this.channel.on("error", () => undefined);

      await this.declareTopology(this.channel);
      await this.channel.prefetch(5);

      const channel = this.channel;
      const result = await channel.consume(
        PAYMENTS_CREATION_REQUESTS_QUEUE,
        (msg) => {
          if (msg) {
            void this.handle(channel, msg);
          }
        },
        { noAck: false },
      );

      this.consumerTag = result.consumerTag;
    } catch (error) {
      this.logger.error(
        { errorType: error instanceof Error ? error.name : "UnknownError" },
        "Falha ao conectar consumidor de solicitações de pagamento.",
      );
      await this.connection?.close().catch(() => undefined);

      this.connection = undefined;
      this.channel = undefined;
      this.reconnect();
    }
  }

  private async declareTopology(channel: ConfirmChannel) {
    await channel.assertExchange(RABBITMQ_EVENTS_EXCHANGE, "topic", {
      durable: true,
    });
    await channel.assertExchange(DLX, "topic", { durable: true });
    await channel.assertQueue(PAYMENTS_CREATION_REQUESTS_DLQ, {
      durable: true,
    });
    await channel.bindQueue(
      PAYMENTS_CREATION_REQUESTS_DLQ,
      DLX,
      PAYMENTS_CREATION_REQUESTS_FAILED_ROUTE,
    );
    await channel.assertQueue(PAYMENTS_CREATION_REQUESTS_RETRY_QUEUE, {
      durable: true,
      arguments: {
        "x-message-ttl": RETRY_DELAY_MS,
        "x-dead-letter-exchange": RABBITMQ_EVENTS_EXCHANGE,
        "x-dead-letter-routing-key": PAYMENT_CREATION_REQUESTED_EVENT,
      },
    });
    await channel.assertQueue(PAYMENTS_CREATION_REQUESTS_QUEUE, {
      durable: true,
      arguments: {
        "x-dead-letter-exchange": DLX,
        "x-dead-letter-routing-key": PAYMENTS_CREATION_REQUESTS_FAILED_ROUTE,
      },
    });
    await channel.bindQueue(
      PAYMENTS_CREATION_REQUESTS_QUEUE,
      RABBITMQ_EVENTS_EXCHANGE,
      PAYMENT_CREATION_REQUESTED_EVENT,
    );
  }

  private async handle(channel: ConfirmChannel, message: ConsumeMessage) {
    let event: unknown;
    try {
      event = JSON.parse(message.content.toString());
    } catch {
      channel.nack(message, false, false);
      return;
    }

    if (!isPaymentCreationRequestedEvent(event)) {
      this.logger.warn(
        { messageId: message.properties.messageId },
        "Solicitação de pagamento inválida enviada à DLQ.",
      );
      channel.nack(message, false, false);
      return;
    }

    try {
      await this.payments.handlePaymentCreationRequested(event.eventId, {
        orderId: event.data.orderId,
        amount: event.data.amount,
      });
      channel.ack(message);
    } catch (error) {
      if ((error as { code?: string })?.code === "P2002") {
        channel.ack(message);
        return;
      }

      const retries = Number(message.properties.headers?.retryCount ?? 0);
      if (retries >= MAX_PROCESSING_RETRIES) {
        channel.nack(message, false, false);
        return;
      }

      try {
        channel.sendToQueue(
          PAYMENTS_CREATION_REQUESTS_RETRY_QUEUE,
          message.content,
          {
            persistent: true,
            contentType: message.properties.contentType,
            messageId: message.properties.messageId,
            headers: { ...message.properties.headers, retryCount: retries + 1 },
          },
        );
        await channel.waitForConfirms();
        channel.ack(message);
      } catch {
        channel.nack(message, false, false);
      }

      this.logger.warn(
        { errorType: error instanceof Error ? error.name : "UnknownError" },
        "Falha ao preparar pagamento; nova tentativa agendada.",
      );
    }
  }

  private reconnect() {
    if (this.stopping || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, 5000);

    this.reconnectTimer.unref();
  }
}
