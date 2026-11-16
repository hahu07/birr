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
   the person's email and role, and why they're joining (at least 10
   characters; the approver reads it first and it's kept in the audit trail),
   then press **Send for approval**. No invitation exists yet; it shows under
   *Invitations awaiting approval*.
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

**Wrong role?** Revoke the pending invitation on the **Team** page (it asks
you to confirm) and propose it again with the right role.

**Giving someone another role, or taking one away.** A staff member can hold
several roles, such as Legal Adviser and Compliance Officer. On **Team**,
the Platform Admin opens the person and chooses **Add a role…** or **Remove a
role…**, picks the role and writes why; a Board member or the Compliance
Officer approves it on **Approvals**,
just like an invitation. The person is notified when it takes effect. Some
rules always apply:

- Nobody can propose, or approve, a change to **their own** roles.
- An **External Auditor** can't hold any other role, so they stay independent of what they audit.
- Everyone keeps **at least one** role.
- The **last active Platform Admin** can't lose that role.

**Changing what a role can do.** On **Roles & Access**, the Platform Admin
uses **Propose a change**: pick a role, a permission, and the new setting.
A Board member approves it on **Approvals**, and it takes effect straight
away. The system refuses any change that would leave an approval action
with nobody able to propose or approve it, give one role both sides of the
same approval, or give the External Auditor either side.

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

## C. Suspending someone, and reinstating them

When someone leaves Birr, or their access must stop while something is
looked into, suspend them. It's two-person, like adding staff.

1. A **Platform Admin** opens **Team**, opens that person, chooses
   **Suspend…**, and writes why (at least 10 characters). Nothing changes
   yet.
2. A **Board member or Compliance officer** approves it on
   **Approvals**. Confirm the reason through a separate channel first.
3. From their next click, the suspended person is refused everywhere in
   the Ops Console.

The approval screen shows how many proposals they have awaiting
approval and how many active case assignments they hold: reassign the
case assignments, and decide or reject their open proposals.

Birr refuses a suspension that would leave any approval action with
nobody active able to propose it or approve it, or that would remove
the last active Platform Admin. Bring someone else into the role first.

To let them back in, **Reinstate…** works the same way. Nobody can
suspend or reinstate themselves.

## Reviewing staff access

The **Team** page shows, for every staff member, their roles, whether
two-factor is set up, and when they last signed in. Use **Needs attention**
to list anyone without two-factor or with no sign-in for 90 days. A dormant
account is only flagged, never suspended automatically: confirm with the
person and their manager, then suspend it if it's no longer needed. Open a
person to see their history: every invitation, role change, suspension and
two-factor reset about them, with its reason and who proposed and approved
it. (History is visible to staff managers: Platform Admins, the Board,
Compliance and the Audit Committee.) Anything awaiting approval is marked
on their row, and no other change can be proposed for them until it's
decided.

