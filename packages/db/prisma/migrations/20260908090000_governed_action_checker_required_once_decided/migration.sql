-- 2026-09-08 audit fix (Trust Ledger Audit — see CLAUDE.md/this migration's
-- sibling 20260731201431_governed_actions_constraints for the original
-- maker/checker constraints).
--
-- checker_not_maker (added there) is correctly NULL-safe, but nothing
-- required a checker to actually be recorded before a governed_action
-- reached a decided status — a row could reach status = 'approved' (or
-- 'rejected') with checkerUserId still NULL, which vacuously satisfies
-- checker_not_maker ("NULL <> makerUserId" is never a violation) without a
-- real checker ever having been identified. This closes that: once a row
-- leaves 'proposed', a checkerUserId is mandatory.
ALTER TABLE "governed_actions"
  ADD CONSTRAINT "checker_required_once_decided"
  CHECK (status = 'proposed' OR "checkerUserId" IS NOT NULL);
