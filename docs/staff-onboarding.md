# Adding a Birr staff member

Adding someone to Birr's staff always takes two people. A Platform Admin
proposes it, and a Board of Trustees member or the Compliance Officer approves
it. Nobody can do it alone, not even a Platform Admin. Otherwise one person
could add a second account of their own under another role, then propose and
approve their own actions.

Which situation are you in?

| Situation | Use |
|---|---|
| At least one Board member or Compliance Officer can sign in | **A. Normal onboarding** (two people, in the app). |
| A brand-new setup: nobody yet holds the Board or Compliance role | **B. First approver** (from the server, once). |

---

## A. Normal onboarding — in the app

1. **Platform Admin:** Ops Console → **Team** → **Invite staff member**. Enter
   the person's email and role, then press **Send for approval**. No invitation
   exists yet.
2. **Approver (Board or Compliance), a different person:** before approving,
   confirm through a separate channel, such as a phone call or in person, that
   this is a real, new staff member and the role is right. Then open
   **Approvals** and approve it. A forged request would be sent by email or
   chat, so don't rely on those to confirm.
3. The invitation is emailed to the person straight away. It works for 7 days.
4. They open the link, choose a password, and set up two-factor
   authentication at their first sign-in.

**The email didn't arrive?** The Platform Admin presses **Resend email** next
to the invitation on the **Team** page. The invitation link is deliberately
never shown in the app. Whoever opens it chooses the account's password, so it
must only ever reach the invited person's inbox.

**Wrong role?** Revoke the pending invitation on the **Team** page and propose
it again with the right role.

---

## B. First approver — from the server

Only for a brand-new setup where nobody holds the Board of Trustees or
Compliance Officer role yet, so there's nobody to approve step A. The script
refuses to run once any active Board member or Compliance Officer exists.

Run it from the production container, where the database settings are already
in place. First run without `--execute` to see what it will do:

```sh
node dist/scripts/bootstrap-first-approver.cli.js \
  --email amina.yusuf@birr.org --role board_of_trustees \
  --invited-by admin@birr.org \
  --reason "First Board member on a new deployment; identity confirmed in person 2026-10-18"
```

Then run the same command again with `--execute` added. It:

- creates a 7-day invitation for that person, in that role (`board_of_trustees`
  or `compliance_officer` only);
- writes an audit record (`invitation.bootstrap_sent`) with your reason;
- prints the invitation link. **It does not send an email.** Give the link to
  the person directly, then delete it from wherever you copied it.

From then on, add everyone else with **A**.
