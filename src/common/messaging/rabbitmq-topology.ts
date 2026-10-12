export const RABBITMQ_EVENTS_EXCHANGE = "vortex.events";
export const PAYMENT_CREATION_REQUESTED_EVENT = "payment.creation.requested";
export const PAYMENT_CREATION_SUCCEEDED_EVENT = "payment.creation.succeeded";
export const PAYMENT_STATUS_CHANGED_EVENT = "payment.status.changed";
export const PAYMENTS_CREATION_REQUESTS_QUEUE = "payments.creation-requests";
export const PAYMENTS_CREATION_REQUESTS_RETRY_QUEUE =
  "payments.creation-requests.retry";
export const PAYMENTS_CREATION_REQUESTS_DLQ = "payments.creation-requests.dlq";
export const PAYMENTS_CREATION_REQUESTS_FAILED_ROUTE =
  "payments.creation-requests.failed";
export const MAX_PROCESSING_RETRIES = 5;
export const RETRY_DELAY_MS = 5000;
