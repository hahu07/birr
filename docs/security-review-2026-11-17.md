# Security review before launch — 2026-11-17

A review of the backend and web app before launch, done at the owner's
request. Findings are ranked by severity. Each one says what was wrong,
how it was shown, and where it was fixed.

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | Critical | Two-factor could be skipped with a password alone | Fixed (urgent PR) |
| 2 | High | Any staff member could take a founder's or co-founder's seat | Fixed (urgent PR) |
| 3 | High | Behind a proxy, every visitor would share one IP address | Fixed (urgent PR); set `TRUST_PROXY_HOPS` at deploy |
| 4 | Medium | No security headers on the web app (clickjacking) | Fixed (second PR) |
| 5 | Medium | Sessions survive a password or two-factor reset | Fixed (second PR) |
| 6 | Medium | Reset and verification tokens are stored as typed | Fixed (second PR) |
| 7 | Low | A two-factor code can be used twice within ~90 seconds | Fixed (second PR) |
| 8 | Info | Next.js 16.4.3 has a moderate advisory | Not reachable here; updated to 16.4.6 |

### 1. Two-factor could be skipped (critical)

After a correct password, sign-in issues a short-lived "now enter your
code" token in a cookie. It was signed with the same secret as a full
session and carried the same `userId`, and the session check only
looked for a `userId`. Anyone with a staff member's password could copy
that token from their own browser into the session cookie and be signed
in as them, with every permission, without a code. Founder sign-in had
the same hole.

**Shown:** on the dev server, the waiting token sent as a staff session
returned 200 with 26 permissions.

**Fixed:** a full session token is marked `purpose: "session"`, and only
those are accepted (`common/auth/session.ts`; `session.spec.ts`). Every
session issued before the fix stops working, so everyone signs in once
again.

### 2. Any staff member could take a founder's seat (high)

`GET /invitations` showed every pending founder and co-founder invitation
link to any active staff member, External Auditor included. Accepting an
invitation creates the account under the invited email with whatever
password the link-holder chooses. So a staff member could join a
Foundation as someone else; as a co-founder, they could agree to the
joint deed in that person's name.

**Shown:** an External Auditor's session listed 3 working links.

**Fixed:** staff see a founder-side link only if they sent the invitation
themselves (`redactInvitationTokenFor`). Staff invitations stay
email-only, as decided on 2026-10-18.

### 3. Every visitor would share one IP address (high)

The API never told Express it runs behind a proxy, so in production
`request.ip` would be the proxy's address for everyone. As a result:

- the global rate limit would become 100 requests a minute for the
  whole site;
- the WhatsApp code limit would become 10 an hour for everyone together;
- the AML review would flag all givers as sharing a network;
- signed deeds would record the proxy's IP.

**Shown:** with the fix, one visitor is limited after 5 reset requests
while six different visitors each get through.

**Fixed:** `TRUST_PROXY_HOPS` (`main.ts`, `.env.example`). It must be set
to the real number of proxies (1 for Render or nginx). It isn't simply
always on, because trusting a proxy that isn't there lets anyone choose
their IP with an `X-Forwarded-For` header. Production warns at start-up
when it's unset, and it's on the deploy checklist.

### 4. No security headers on the web app (medium)

Nothing stopped another site from showing Ops Console pages in a hidden
frame and tricking a signed-in staff member into clicking "Approve".

**Fixed:** every page sends `X-Frame-Options: DENY` and
`frame-ancestors 'none'`, plus `nosniff`, a strict referrer policy, a
permissions policy and, in production, HSTS (`apps/web/next.config.mjs`).
Checked on `/ops/sign-in`, `/` and `/zakah`. Paystack checkout is a
redirect, not a frame, so it isn't affected.

### 5. Sessions survive a password or two-factor reset (medium)

Sessions last 7 days and nothing ends them early. Resetting a password,
or having two-factor reset, leaves anyone already signed in still signed
in. (Suspending staff does take effect at once.)

**Fixed:** `users.sessionsValidFrom`. A password reset, a staff or founder
two-factor reset, and the emergency two-factor reset set it to now. Both
portals refuse a session issued before it (`sessionStillValid`).

### 6. Reset and verification tokens are stored as typed (medium)

`users.passwordResetToken` and `verificationToken` hold the token itself.
Anyone who can read the database or a backup could reset any account.
Monthly-giving manage links already store only a hash.

**Fixed:** both are stored as a SHA-256 hash (`common/auth/token-hash.ts`).
The migration hashed the outstanding ones too, so links already emailed
still work. Invitation tokens stay as they are, because a founder's
"copy link" needs the link itself; finding 2 limits who can see one.

### 7. A two-factor code can be used twice (low)

A code is accepted for its ±30-second window, and nothing records that
it was used. Someone who sees a code being typed could use it again
within about 90 seconds (they would still need the password).

**Fixed:** sign-in records the 30-second step of the code it accepts
(`users.mfaLastUsedStep`) and refuses a code from that step or earlier.
A backup code is now claimed in one write, so two requests sent at the
same moment can't both use it (`common/auth/mfa-claims.ts`).

### 8. Next.js advisory (info)

The dependency audit shows no high or critical advisories (18 moderate,
5 low, mostly in libraries underneath). One is in Next.js 16.4.3: "Information
disclosure across root params when a 'use cache' function is called
through unstable_cache()". Birr uses neither feature, so it can't be
reached here, but 16.4.5 fixes it. **Done, 2026-11-17:** updated to 16.4.6
(the latest patch, which includes the fix), with `@next/eslint-plugin-next`
to match; the audit no longer lists any Next.js advisory.

## Follow-on, not security

`AuditLogsService.exportChain()` loaded the whole audit trail into memory
at once (70,500 rows in the dev database), and the Ops page then parsed
and re-encoded it in the browser. **Done, 2026-11-17:** the export now
fixes the chain head, reads 1,000 rows at a time and streams the file
(`planChainExport`, `streamChainExport`); the page saves it as it
arrives. Same file shape. Checked on the dev database: 74,428 records,
101.5 MB, in 18 seconds.

## Checked and sound

- **Founders can't reach each other's records.** All 33 founder read
  routes were tested live as one founder against another's fund, and
  every write handler was read. Every one refuses, and none returned the
  other founder's ids.
- **The two-person rule.** The guard checks that the approver's role may
  approve that kind of action, the database refuses maker = checker, and
  a decision is claimed atomically.
- **Webhooks.** Paystack (HMAC-SHA512), card and crypto all verify a
  signature with a timing-safe comparison and refuse when unconfigured.
  Paystack amounts are re-checked against Paystack.
- **Uploads.** Every upload checks the real file type from its bytes,
  names the file itself (random name, its own extension), and is served
  with `nosniff`. Private folders check who's asking.
- **Injection.** No raw SQL is built from strings, and the web app never
  injects HTML.
- **Secrets.** Platform Settings only ever returns a masked value, and AI
  agent keys are stored as bcrypt hashes.
- **Rate limits.** Every public route has one (once finding 3 is
  configured).
- **CORS.** Only the configured origins are allowed, and it fails closed
  when unset.

Dev-only note: some invitation audit rows written before 2026-10-18
still hold raw invitation tokens. A fresh production database won't have
them.
