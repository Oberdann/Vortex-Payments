import { createHmac, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { MercadoPagoIntegrationException } from "./exceptions/mercado-pago-integration.exception";

export interface MercadoPagoPayment {
  id: number | string;
  external_reference: string;
  transaction_amount: number;
  status: string;
  status_detail?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateMercadoPagoPaymentInput {
  paymentId: string;
  attemptId: string;
  orderId: string;
  amount: number;
  idempotencyKey: string;
  token: string;
  paymentMethodId: string;
  installments: number;
  issuerId?: string;
  payer: {
    email: string;
    identification?: { type: string; number: string };
  };
}

@Injectable()
export class MercadoPagoGateway {
  async createPayment(
    input: CreateMercadoPagoPaymentInput,
  ): Promise<MercadoPagoPayment> {
    const notificationUrl = process.env.MERCADO_PAGO_NOTIFICATION_URL;

    if (notificationUrl && !notificationUrl.startsWith("https://")) {
      throw new MercadoPagoIntegrationException(
        "A URL de notificação do Mercado Pago precisa usar HTTPS.",
        500,
      );
    }

    const response = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        ...this.getHeaders(),
        "X-Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        token: input.token,
        transaction_amount: input.amount,
        installments: input.installments,
        payment_method_id: input.paymentMethodId,
        ...(input.issuerId ? { issuer_id: input.issuerId } : {}),
        payer: input.payer,
        external_reference: input.orderId,
        ...(notificationUrl ? { notification_url: notificationUrl } : {}),
        metadata: {
          vortex_payment_id: input.paymentId,
          vortex_payment_attempt_id: input.attemptId,
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const payment = await this.readResponse<MercadoPagoPayment>(response);

    if (
      !payment.id ||
      !payment.status ||
      payment.external_reference !== input.orderId ||
      !Number.isFinite(payment.transaction_amount) ||
      payment.transaction_amount !== input.amount
    ) {
      throw new MercadoPagoIntegrationException(
        "Mercado Pago retornou dados incompletos ou divergentes para o pagamento.",
      );
    }

    return payment;
  }

  async getPayment(paymentId: string): Promise<MercadoPagoPayment> {
    const response = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
      {
        method: "GET",
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(10_000),
      },
    );

    const payment = await this.readResponse<MercadoPagoPayment>(response);

    if (
      !payment.id ||
      !payment.external_reference ||
      !Number.isFinite(payment.transaction_amount) ||
      !payment.status
    ) {
      throw new MercadoPagoIntegrationException(
        "Mercado Pago retornou dados incompletos do pagamento.",
      );
    }

    return payment;
  }

  isValidWebhookSignature(input: {
    signatureHeader: string | undefined;
    requestId: string | undefined;
    dataId: string | undefined;
  }): boolean {
    const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
    if (
      !secret ||
      !input.signatureHeader ||
      !input.requestId ||
      !input.dataId
    ) {
      return false;
    }

    const values = Object.fromEntries(
      input.signatureHeader.split(",").map((part) => {
        const [key, value] = part.trim().split("=");
        return [key, value];
      }),
    );
    const timestamp = values.ts;
    const receivedSignature = values.v1;

    if (!timestamp || !receivedSignature) {
      return false;
    }

    const manifest = `id:${input.dataId.toLowerCase()};request-id:${input.requestId};ts:${timestamp};`;
    const expectedSignature = createHmac("sha256", secret)
      .update(manifest)
      .digest("hex");
    const expected = Buffer.from(expectedSignature, "hex");
    const received = Buffer.from(receivedSignature, "hex");

    return (
      expected.length === received.length && timingSafeEqual(expected, received)
    );
  }

  private getHeaders(): HeadersInit {
    const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;

    if (!accessToken) {
      throw new MercadoPagoIntegrationException(
        "A credencial do Mercado Pago não está configurada.",
        500,
      );
    }

    return {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };
  }

  private async readResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const responseText = await response.text();
      let providerDetail = "";

      try {
        const body = JSON.parse(responseText) as {
          error?: unknown;
          message?: unknown;
          cause?: Array<{ code?: unknown; description?: unknown }>;
        };
        
        const causes = Array.isArray(body.cause)
          ? body.cause
              .map((cause) =>
                [cause.code, cause.description]
                  .filter((value): value is string => typeof value === "string")
                  .join(": "),
              )
              .filter(Boolean)
          : [];

        providerDetail = [body.error, body.message, ...causes]
          .filter((value): value is string => typeof value === "string")
          .join("; ");
      } catch {
        // Keep the generic status when the provider response is not valid JSON.
      }

      throw new MercadoPagoIntegrationException(
        `Mercado Pago respondeu com HTTP ${response.status}.${providerDetail ? ` ${providerDetail}` : ""}`,
      );
    }
    return (await response.json()) as T;
  }
}
