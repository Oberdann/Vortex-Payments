import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { MercadoPagoIntegrationException } from './exceptions/mercado-pago-integration.exception';

interface MercadoPagoPreferenceResponse {
  id: string;
  init_point: string;
}

export interface MercadoPagoPayment {
  id: number | string;
  external_reference: string;
  transaction_amount: number;
  status: string;
}

@Injectable()
export class MercadoPagoGateway {
  async createCheckoutPreference(input: {
    paymentId: string;
    orderId: string;
    amount: number;
  }): Promise<{ id: string; checkoutUrl: string }> {
    const notificationUrl = process.env.MERCADO_PAGO_NOTIFICATION_URL;

    if (notificationUrl && !notificationUrl.startsWith('https://')) {
      throw new MercadoPagoIntegrationException(
        'A URL de notificação do Mercado Pago precisa usar HTTPS.',
        500,
      );
    }

    const response = await fetch(
      'https://api.mercadopago.com/checkout/preferences',
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          items: [
            {
              id: input.orderId,
              title: `Pedido ${input.orderId}`,
              quantity: 1,
              currency_id: 'BRL',
              unit_price: input.amount,
            },
          ],
          external_reference: input.orderId,
          ...(notificationUrl ? { notification_url: notificationUrl } : {}),
          metadata: { vortex_payment_id: input.paymentId },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );

    const preference =
      await this.readResponse<MercadoPagoPreferenceResponse>(response);

    if (!preference.id || !preference.init_point) {
      throw new MercadoPagoIntegrationException(
        'Mercado Pago retornou uma preferência sem ID ou URL de checkout.',
      );
    }

    return { id: preference.id, checkoutUrl: preference.init_point };
  }

  async getPayment(paymentId: string): Promise<MercadoPagoPayment> {
    const response = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
      {
        method: 'GET',
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
        'Mercado Pago retornou dados incompletos do pagamento.',
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
    if (!secret || !input.signatureHeader || !input.requestId || !input.dataId) {
      return false;
    }

    const values = Object.fromEntries(
      input.signatureHeader.split(',').map((part) => {
        const [key, value] = part.trim().split('=');
        return [key, value];
      }),
    );

    const timestamp = values.ts;

    const receivedSignature = values.v1;

    if (!timestamp || !receivedSignature) return false;

    const manifest = `id:${input.dataId.toLowerCase()};request-id:${input.requestId};ts:${timestamp};`;

    const expectedSignature = createHmac('sha256', secret)
      .update(manifest)
      .digest('hex');

    const expected = Buffer.from(expectedSignature, 'hex');

    const received = Buffer.from(receivedSignature, 'hex');

    return (
      expected.length === received.length && timingSafeEqual(expected, received)
    );
  }

  private getHeaders(): HeadersInit {
    const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    
    if (!accessToken) {
      throw new MercadoPagoIntegrationException(
        'A credencial do Mercado Pago não está configurada.',
        500,
      );
    }

    return {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  private async readResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      throw new MercadoPagoIntegrationException(
        `Mercado Pago respondeu com HTTP ${response.status}.`,
      );
    }

    return (await response.json()) as T;
  }
}
