# Birr staff — two-factor (MFA) recovery

Every Birr staff account must use two-factor authentication (an authenticator
app, with 10 single-use backup codes issued at enrolment). This page covers
what to do when someone loses access to it. There is no self-service "I lost
my phone" button — that is deliberate, because an attacker who knows a password
would otherwise be able to use it.

Which situation are you in?

| Situation | Use |
|---|---|
| Someone lost their authenticator **but still has a backup code** | Sign in with the backup code, then re-enrol (below). Each code works once. |
| Someone lost both, and **a Platform Admin can still sign in** | **A. Normal reset** (two people, inside the app). |
| The person locked out is the **only Platform Admin**, or no Platform Admin can sign in | **B. Emergency recovery** (two people, from the server). |

---

## A. Normal reset — in the app

A reset needs two different people. Neither can do it alone.

1. **Confirm who is asking, outside the app.** Call them or meet them. Do not
   rely on an email or chat message — that is exactly what an attacker would
   send.
2. A **Platform Admin** opens *Admin → Team*, finds the person, and clicks
   **Request MFA reset**. Nothing changes yet.
3. A **Board member or Compliance officer** (never another Platform Admin)
   sees it under *Governance → Approvals*. Before approving they must
   **independently re-confirm the request by a separate channel** — the queue
   text reminds them. They approve or reject.
4. On approval: the person's authenticator and all backup codes are cleared, and
   they must re-enrol at their next sign-in. Their password is unchanged.
5. **They are emailed (and WhatsApped, if verified) immediately**, naming who
   requested and who approved. If they didn't ask for this, they must contact
   the security lead at once and not sign in.
6. Both steps are in the audit log (`governed_action.proposed`,
   `governed_action.approved`, `birr_staff.mfa_reset`).

Re-enrolment: sign in with the password → follow the prompt → scan the QR code →
**save the new backup codes somewhere safe and separate from the phone**.

## B. Emergency recovery — a lone, locked-out Platform Admin

Only when nobody can propose a reset in the app (e.g. the single Platform Admin
lost the phone **and** the backup codes). It re-creates the two-person rule
outside the app. It needs **production shell access** (whoever deploys/operates
the backend), which is a separate credential from any Birr staff login — keep
the number of people who hold it small.

**Before running anything — all four must be true, and written down**

1. The person being recovered has been **identified in real time** (video call
   with ID, or in person) — not by email or message alone.
2. **Two other people** have each agreed, separately, to the recovery:
   one from `board_of_trustees` and/or `compliance_officer`, two different
   individuals, **neither of them the person being recovered**. (The tool
   enforces the roles and that all three are different people.)
3. A short written record exists saying who asked, how identity was confirmed,
   and who approved (an email thread among the two approvers is enough).
4. The two approvers know the exact time you will run it, so an unexpected run
   is noticed.

**Run it** (from the backend container / server, with its normal environment):

```bash
# 1. Dry run — prints what WOULD happen and changes nothing.
node dist/scripts/emergency-mfa-reset.cli.js \
  --target lost.admin@birr.org \
  --approver-1 board.member@birr.org \
  --approver-2 compliance.officer@birr.org \
  --reason "Sole platform admin lost phone and backup codes; identity confirmed on video call 2026-10-01 by A. and B."

# 2. Read the summary aloud to both approvers. If correct, run again with --execute.
node dist/scripts/emergency-mfa-reset.cli.js ...same arguments... --execute
```

The tool refuses unless: the reason is at least 20 characters; the two
approvers are different people, both **active** Board/Compliance staff, and
neither is the target; and the target is an active staff account that actually
has MFA enrolled.

**After**

1. Tell the person directly, now (the tool can only leave an in-app notice;
   it cannot send email). They sign in with their password and re-enrol,
   saving the new backup codes.
2. The audit log now holds a `birr_staff.mfa_reset_emergency` record (actor
   type `system`) with both approvers' ids and emails and the reason. Check it
   is there.
3. Tell both approvers it is done. Keep the written record from step 3 above.

**Do not** reset MFA by editing the database by hand: it leaves no audit
record and skips every check above.

## Preventing the lone-admin problem

- **Keep at least two active Platform Admins.** One can then request a reset for
  the other (path A), and path B should never be needed. The *Team* page warns
  when there are fewer than two.
- Make sure at least **two Board/Compliance staff are active** — they are the
  approvers for both paths.
- Store backup codes away from the phone (a password manager or a printed copy
  in a safe).
- Review `birr_staff.mfa_reset` and `birr_staff.mfa_reset_emergency` audit
  entries periodically; each should match a request you recognise.

## Founder Portal accounts

A Founder who loses their authenticator **and** backup codes follows the same
two-person rule — there is no self-service recovery for them either.

1. The Founder contacts Birr. **Confirm it is really them, outside the app**
   (call back on a number already on file, or the contact details in their
   Foundation record) — not by replying to an email.
2. A **Platform Admin** opens the Foundation in the Ops Console, finds the
   person under that Foundation's team, and clicks **Request MFA reset**.
3. A **Board member or Compliance officer** approves it under *Governance →
   Approvals*, after independently re-confirming the request.
4. On approval their authenticator and backup codes are cleared and they must
   re-enrol at next sign-in (password unchanged). **They are emailed (and
   WhatsApped, if verified) at once**, with an instruction to contact Birr if
   they didn't ask for it. The email does not name the Birr staff involved; the
   audit log (`governed_action.*`, `founder.mfa_reset`) does.

The request is refused for an unknown user, someone with no MFA enrolled, or a
Birr staff account (staff have their own reset above). A Founder reset never
needs the emergency procedure in B: that exists only because staff recovery
depends on a staff member being able to sign in.
