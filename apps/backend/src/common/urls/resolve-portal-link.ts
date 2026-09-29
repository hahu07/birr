// The one deployment serving both the Founder Portal and Ops Console
// (see render.yaml's own "Merged Founder Portal + Ops Console" comment)
// — every notification linkUrl across this codebase is built as a bare
// relative path (e.g. "/portfolio/abc", "/ops/governed-actions"), which
// is correct for the in-app bell (the frontend's own router resolves it
// — see AppShell's handleSelectNotification) but not for an external
// channel: email or WhatsApp has no router, so a relative path there is
// simply not a valid, clickable link. Found live 2026-09-29 — every
// notification WhatsApp message and email "View in Birr" button had
// been sending an unclickable relative path since the day both channels
// shipped.
//
// Same env var and fallback FoundersController.verifyEmail and several
// other call sites already use to build an absolute link correctly —
// this just centralizes it for the one place (NotificationsService)
// that had been skipping the step, rather than inventing a new pattern.
export function resolvePortalLink(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const base = process.env.FOUNDER_PORTAL_URL ?? "http://localhost:3000";
  return `${base}${path}`;
}
