ALTER TABLE "Payment"
ADD COLUMN "providerPreferenceId" TEXT,
ADD COLUMN "checkoutUrl" TEXT;

CREATE UNIQUE INDEX "Payment_providerPreferenceId_key"
ON "Payment"("providerPreferenceId");

ALTER TYPE "PaymentStatus" ADD VALUE 'REFUNDED';
ALTER TYPE "PaymentStatus" ADD VALUE 'CHARGED_BACK';
