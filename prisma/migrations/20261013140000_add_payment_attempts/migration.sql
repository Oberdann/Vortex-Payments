ALTER TABLE "Payment"
ADD COLUMN "currentAttemptId" UUID;

CREATE UNIQUE INDEX "Payment_currentAttemptId_key"
ON "Payment"("currentAttemptId");

CREATE TABLE "PaymentAttempt" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "providerPaymentId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PaymentAttempt_paymentId_fkey" FOREIGN KEY ("paymentId")
      REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PaymentAttempt_idempotencyKey_key"
ON "PaymentAttempt"("idempotencyKey");
CREATE UNIQUE INDEX "PaymentAttempt_providerPaymentId_key"
ON "PaymentAttempt"("providerPaymentId");
CREATE INDEX "PaymentAttempt_paymentId_createdAt_idx"
ON "PaymentAttempt"("paymentId", "createdAt");
