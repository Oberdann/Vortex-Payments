# Vortex Payments Service

Microsserviço responsável por registrar pagamentos de pedidos, processar
tentativas com o Mercado Pago e publicar as mudanças de estado para os demais
serviços.

## Fluxo

1. O serviço consome `payment.creation.requested` e registra o pagamento de
   forma idempotente usando Inbox e Outbox.
2. `POST /api/v1/payments` cria uma tentativa de pagamento com os dados
   tokenizados pelo Mercado Pago.js. Envie um UUID v4 em
   `X-Idempotency-Key` e reutilize a chave ao repetir a mesma tentativa.
3. O webhook valida a assinatura e consulta o pagamento diretamente no Mercado
   Pago antes de atualizar o estado local.
4. O serviço publica `payment.ready` e `payment.status.changed` pela Outbox.

O valor do pagamento e o `orderId` vêm do evento de criação do pedido; o cliente
não define esses dados no endpoint de tentativa.

## Configuração e execução

Configure `PAYMENTS_DB_URL`, `RABBITMQ_URL`, `MERCADO_PAGO_ACCESS_TOKEN` e
`MERCADO_PAGO_WEBHOOK_SECRET`. `MERCADO_PAGO_NOTIFICATION_URL` é opcional e,
quando configurada, deve usar HTTPS público e apontar para
`/api/v1/payments/webhooks/mercado-pago`.

```bash
npm install
npm run prisma:generate
npm run prisma:migrate:dev
npm run dev
```

Swagger: `/doc`  
Métricas: `/api/v1/metrics`
