-- Waqf programmes, step 2 (2026-11-17): permission keys split between the
-- general waqf programme (waqf_programme.*) and the clinic's own parts
-- (clinic.*). Renamed in place, so every role grant, including any the
-- Board has changed in Roles & Access, and every governed action already
-- proposed or decided keep pointing at the same permission.

UPDATE "permissions" SET "key" = 'waqf_programme.establish', "category" = 'waqf_programme', "description" = 'Establish a waqf programme, after its deed is approved. Once established it''s a waqf for ever.' WHERE "key" = 'clinic_waqf.establish';
UPDATE "permissions" SET "key" = 'waqf_programme.asset_add', "category" = 'waqf_programme', "description" = 'Add land, a building or equipment given in kind to a waqf programme''s endowment, at its valuation.' WHERE "key" = 'clinic_waqf.asset_add';
UPDATE "permissions" SET "key" = 'waqf_programme.asset_dispose', "category" = 'waqf_programme', "description" = 'Dispose of a waqf programme''s asset: sell, scrap or exchange it, with any proceeds kept in the endowment.' WHERE "key" = 'clinic_waqf.asset_dispose';
UPDATE "permissions" SET "key" = 'waqf_programme.works_approve', "category" = 'waqf_programme', "description" = 'Approve a waqf programme''s building or renovation project: its route, contractor and budget.' WHERE "key" = 'clinic_waqf.works_approve';
UPDATE "permissions" SET "key" = 'waqf_programme.spend_approve', "category" = 'waqf_programme', "description" = 'Approve paying out of a waqf programme''s endowment cash, for equipment or a certified works stage.' WHERE "key" = 'clinic_waqf.spend_approve';
UPDATE "permissions" SET "key" = 'waqf_programme.spend_mark_paid', "category" = 'waqf_programme', "description" = 'Confirm an approved waqf programme payment was made, from the bank''s reference, which books it.' WHERE "key" = 'clinic_waqf.spend_mark_paid';
UPDATE "permissions" SET "key" = 'clinic.price_list_approve', "category" = 'clinic', "description" = 'Approve a version of a clinic waqf''s price list and subsidy bands, which monthly claims are checked against.' WHERE "key" = 'clinic_waqf.price_list_approve';
UPDATE "permissions" SET "key" = 'clinic.operator_assign', "category" = 'clinic', "description" = 'Assign the licensed healthcare provider that runs a clinic waqf''s clinic, whose monthly claims it pays.' WHERE "key" = 'clinic_waqf.operator_assign';
UPDATE "permissions" SET "key" = 'clinic.claim_approve', "category" = 'clinic', "description" = 'Approve a clinic''s monthly claim, checked against the price list, bands and monthly cap, so its running fund part may be paid.' WHERE "key" = 'clinic_waqf.claim_approve';
UPDATE "permissions" SET "key" = 'clinic.claim_mark_paid', "category" = 'clinic', "description" = 'Confirm a clinic claim''s running fund part was paid, from the bank''s reference, which books it.' WHERE "key" = 'clinic_waqf.claim_mark_paid';
UPDATE "permissions" SET "key" = 'waqf_programme.reserve_share_set', "category" = 'waqf_programme', "description" = 'Set the share of a waqf programme''s endowment income set aside for replacing its equipment.' WHERE "key" = 'clinic_waqf.reserve_share_set';
UPDATE "permissions" SET "key" = 'waqf_programme.deed_approve', "category" = 'waqf_programme', "description" = 'Approve a version of a waqf programme''s deed, the wording supporters accept when they endow.' WHERE "key" = 'clinic_waqf.deed_approve';
UPDATE "permissions" SET "key" = 'waqf_programme.investment_manage', "category" = 'waqf_programme', "description" = 'Record a waqf programme investment, propose placing it, and record its principal coming back.' WHERE "key" = 'clinic_waqf.investment_manage';
UPDATE "permissions" SET "key" = 'waqf_programme.investment_shariah_screen', "category" = 'shariah', "description" = 'Decide the Shariah screening of a waqf programme investment.' WHERE "key" = 'clinic_waqf.investment_shariah_screen';
UPDATE "permissions" SET "key" = 'waqf_programme.investment_income_record', "category" = 'waqf_programme', "description" = 'Record income a waqf programme investment paid, into the running fund.' WHERE "key" = 'clinic_waqf.investment_income_record';
UPDATE "permissions" SET "key" = 'clinic.report_record', "category" = 'clinic', "description" = 'Record a clinic''s monthly figures from its operator''s report, for a second person to publish.' WHERE "key" = 'clinic_waqf.report_record';
UPDATE "permissions" SET "key" = 'clinic.report_publish', "category" = 'clinic', "description" = 'Publish a clinic''s monthly figures on its public page, after checking them against the operator''s report.' WHERE "key" = 'clinic_waqf.report_publish';
UPDATE "permissions" SET "key" = 'waqf_programme.manage', "category" = 'waqf_programme', "description" = 'Create a waqf programme and draft or discard versions of its deed (establishing and approving are separate).' WHERE "key" = 'clinic_waqf.manage';

-- The daily Paystack reconciliation names what each flagged payment was.
UPDATE "payment_reconciliation_issues" SET "product" = 'programme_gift' WHERE "product" = 'clinic_gift';
