# Vortex Payments Service

Base NestJS inicial do serviço de pagamentos do Vortex Commerce.

Inclui inicialização HTTP, Swagger, logging estruturado, métricas Prometheus,
instrumentação OpenTelemetry, persistência Prisma e a rota
`GET /api/v1/payments/health`.

O serviço cria preferências do Checkout Pro no Mercado Pago e retorna a URL para
redirecionar o comprador. Também recebe webhooks, valida a assinatura, consulta
o pagamento diretamente no provedor e atualiza o estado local. A publicação
dos resultados para Orders ainda não está implementada.

## Configuração e execução

Copie `.env.example` para `.env`, configure `PAYMENTS_DB_URL`,
`MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET` e o endpoint de
OpenTelemetry. Configure `MERCADO_PAGO_NOTIFICATION_URL` apenas com uma URL HTTPS
pública apontando para `/api/v1/payments/webhooks/mercado-pago`. Instale as
dependências, gere o Prisma Client e aplique as migrations no banco
`paymentsdb`:

```bash
npm install
npm run prisma:generate
npm run prisma:migrate:dev
npm run dev
```

Para iniciar o checkout, envie `POST /api/v1/payments` com `orderId` e `amount`.
A resposta inclui `checkoutUrl`. Consulte o registro com
`GET /api/v1/payments/:id`.

Swagger: `/doc`  
Métricas: `/api/v1/metrics`
