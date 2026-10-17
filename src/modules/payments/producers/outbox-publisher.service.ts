import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import * as amqp from "amqplib";
import { ConfirmChannel } from "amqplib";
import { PinoLogger } from "nestjs-pino";
import { PrismaService } from "src/database/prisma.service";
import { RABBITMQ_EVENTS_EXCHANGE } from "src/common/messaging/rabbitmq-topology";

const POLL_INTERVAL_MS = 3000;
const BATCH_SIZE = 25;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;

@Injectable()
export class OutboxPublisherService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private publishing = false;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {}

  onModuleInit() {
    if (!process.env.RABBITMQ_URL) {
      this.logger.error(
        "RABBITMQ_URL não foi configurada no Payments Service.",
      );
    }

    this.timer = setInterval(
      () => void this.publishPending(),
      POLL_INTERVAL_MS,
    );
    this.timer.unref();

    void this.publishPending();
  }

  onModuleDestroy() {
    this.stopping = true;

    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private async publishPending() {
    const url = process.env.RABBITMQ_URL;

    if (this.publishing || this.stopping || !url) {
      return;
    }

    this.publishing = true;
    let connection: amqp.ChannelModel | undefined;
    let channel: ConfirmChannel | undefined;

    try {
      connection = await amqp.connect(url);
      channel = await connection.createConfirmChannel();

      await channel.assertExchange(RABBITMQ_EVENTS_EXCHANGE, "topic", {
        durable: true,
      });

      const returned = new Set<string>();
      channel.on("return", (msg) => {
        if (msg.properties.messageId) {
          returned.add(msg.properties.messageId);
        }
      });

      const events = await this.prisma.outboxEvent.findMany({
        where: { publishedAt: null, nextAttemptAt: { lte: new Date() } },
        orderBy: { createdAt: "asc" },
        take: BATCH_SIZE,
      });

      for (const event of events) {
        await this.publishOne(channel, event, returned);
      }
    } catch (error) {
      this.logger.error(
        { errorType: error instanceof Error ? error.name : "UnknownError" },
        "Falha ao publicar Outbox do Payments.",
      );
    } finally {
      await channel?.close().catch(() => undefined);
      await connection?.close().catch(() => undefined);

      this.publishing = false;
    }
  }

  private async publishOne(
    channel: ConfirmChannel,
    event: {
      id: string;
      aggregateId: string;
      eventType: string;
      payload: unknown;
      createdAt: Date;
      attempts: number;
    },
    returned: Set<string>,
  ) {
    try {
      channel.publish(
        RABBITMQ_EVENTS_EXCHANGE,
        event.eventType,
        Buffer.from(
          JSON.stringify({
            eventId: event.id,
            eventType: event.eventType,
            occurredAt: event.createdAt.toISOString(),
            data: event.payload,
          }),
        ),
        {
          persistent: true,
          mandatory: true,
          contentType: "application/json",
          messageId: event.id,
          timestamp: event.createdAt.getTime(),
          headers: { aggregateId: event.aggregateId },
        },
      );
      await channel.waitForConfirms();

      if (returned.delete(event.id)) {
        throw new Error("Nenhuma fila vinculada ao evento.");
      }

      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: { publishedAt: new Date(), lastError: null },
      });
    } catch (error) {
      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          attempts: event.attempts + 1,
          nextAttemptAt: new Date(
            Date.now() +
              Math.min(1000 * 2 ** event.attempts, MAX_RETRY_DELAY_MS),
          ),
          lastError: error instanceof Error ? error.name : "UnknownError",
        },
      });

      this.logger.warn(
        { outboxEventId: event.id, eventType: event.eventType },
        "Falha ao publicar evento do Payments; retry agendado.",
      );
    }
  }
}
