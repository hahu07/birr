-- CreateTable
CREATE TABLE "foundation_deeds" (
    "id" TEXT NOT NULL,
    "foundationId" TEXT NOT NULL,
    "signedByUserId" TEXT NOT NULL,
    "signedByFounderId" TEXT NOT NULL,
    "typedLegalName" TEXT NOT NULL,
    "deedTemplateVersion" TEXT NOT NULL,
    "deedText" TEXT NOT NULL,
    "affirmed" BOOLEAN NOT NULL,
    "ipAddress" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "foundation_deeds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "foundation_deeds_foundationId_key" ON "foundation_deeds"("foundationId");

-- AddForeignKey
ALTER TABLE "foundation_deeds" ADD CONSTRAINT "foundation_deeds_foundationId_fkey" FOREIGN KEY ("foundationId") REFERENCES "foundations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "foundation_deeds" ADD CONSTRAINT "foundation_deeds_signedByUserId_fkey" FOREIGN KEY ("signedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "foundation_deeds" ADD CONSTRAINT "foundation_deeds_signedByFounderId_fkey" FOREIGN KEY ("signedByFounderId") REFERENCES "founders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Immutable once written, same enforcement as waqf_deeds — see
-- 20260803180000_waqf_deeds_immutable_via_trigger/migration.sql for why
-- this must be a trigger and not a bare REVOKE UPDATE, DELETE: an
-- incoming RESTRICT FK (there is none pointing at foundation_deeds
-- today, but written this way from the start to avoid that migration's
-- two-step history) relies on Postgres's own `SELECT ... FOR KEY SHARE`
-- locking check, which itself requires UPDATE privilege on the role.
CREATE OR REPLACE FUNCTION foundation_deeds_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'foundation_deeds is immutable once written — % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER foundation_deeds_no_update
  BEFORE UPDATE ON "foundation_deeds"
  FOR EACH ROW EXECUTE FUNCTION foundation_deeds_reject_mutation();

CREATE TRIGGER foundation_deeds_no_delete
  BEFORE DELETE ON "foundation_deeds"
  FOR EACH ROW EXECUTE FUNCTION foundation_deeds_reject_mutation();
