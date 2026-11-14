-- CreateEnum
CREATE TYPE "CoFounderConsentKind" AS ENUM ('adopt_signed_deed', 'authorize_signer');

-- AlterTable
ALTER TABLE "foundations" ADD COLUMN     "establishedJointly" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "co_founder_deed_consents" (
    "id" TEXT NOT NULL,
    "foundationId" TEXT NOT NULL,
    "founderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "CoFounderConsentKind" NOT NULL,
    "foundationDeedId" TEXT,
    "statementVersion" TEXT NOT NULL,
    "statementText" TEXT NOT NULL,
    "ipAddress" TEXT,
    "consentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "co_founder_deed_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "co_founder_deed_consents_foundationId_founderId_key" ON "co_founder_deed_consents"("foundationId", "founderId");

-- AddForeignKey
ALTER TABLE "co_founder_deed_consents" ADD CONSTRAINT "co_founder_deed_consents_foundationId_fkey" FOREIGN KEY ("foundationId") REFERENCES "foundations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "co_founder_deed_consents" ADD CONSTRAINT "co_founder_deed_consents_founderId_fkey" FOREIGN KEY ("founderId") REFERENCES "founders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "co_founder_deed_consents" ADD CONSTRAINT "co_founder_deed_consents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "co_founder_deed_consents" ADD CONSTRAINT "co_founder_deed_consents_foundationDeedId_fkey" FOREIGN KEY ("foundationDeedId") REFERENCES "foundation_deeds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Immutable once written, same enforcement and reasoning as
-- foundation_deeds (20260827145212_add_foundation_deed): a co-founder's
-- recorded consent to the deed is never edited or removed.
CREATE OR REPLACE FUNCTION co_founder_deed_consents_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'co_founder_deed_consents is immutable once written — % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER co_founder_deed_consents_no_update
  BEFORE UPDATE ON "co_founder_deed_consents"
  FOR EACH ROW EXECUTE FUNCTION co_founder_deed_consents_reject_mutation();

CREATE TRIGGER co_founder_deed_consents_no_delete
  BEFORE DELETE ON "co_founder_deed_consents"
  FOR EACH ROW EXECUTE FUNCTION co_founder_deed_consents_reject_mutation();
