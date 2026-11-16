# Changing a Founder's primary contact

Each Founder has exactly one **primary contact**. Only that person can give,
sign the Foundation Deed, set cause allocations and invite teammates. When
they retire, leave, die or can't be reached, the role passes to someone else
through a request that **two Birr staff** decide. Nobody can do it alone, and
the database refuses two active primary contacts for one Founder or two open
requests at once.

Which situation is it?

| Situation | Who asks | Notice before approval |
|---|---|---|
| **Handover.** The contact can still act (retiring, a new Bursar, an institution's leadership changing). | The primary contact, on their **Team** page. | None. |
| **Can't act.** The contact has died, is too unwell, or can't be reached. | Another member on their **Team** page, or a Mutawalli Officer here, for family or an institution. | **7 days** (owner's decision, confirmed 16 Nov 2026). The contact is emailed and sent a WhatsApp at once, and can object. |

Either way, the new primary contact is an existing active member or someone
new, by email and name.

**Before the first "can't act" case:** a Platform Admin sets Birr's contact
email and phone in Ops Console → **Settings** → *Birr contact*. The notice
gives these so a contact who has lost access to their account can still
object, and a reply to the notice email goes to that address. Without them
the notice can only say "contact Birr directly". Someone must read that
inbox and answer that phone.

The notice says (a **draft**; Legal must approve it, and any change gets a
new version in `succession-notice.ts`):

> Someone has told Birr you can no longer act as primary contact of
> *Bello Family Waqf*. If that's wrong, object before *23 Nov 2026*: sign in
> and open Team, or email *…* or call *…* (or reply to this email). Nothing
> changes while you object.

Its email ends: "Please don't ignore this message. If you do nothing, Birr
may give your role as primary contact to someone else after the date above.
If this is wrong, tell Birr." The audit log records which version was sent.

---

## 1. Recording a request (Mutawalli Officer)

Use this when family or an institution tells Birr directly, by phone, letter
or visit. A member who can sign in can ask on their own Team page instead.

1. Ops Console → **Primary Contact Changes** → **Record a request…**
2. Pick the Founder. The page shows the current primary contact.
3. Choose who takes over, give the reason, and describe the **evidence you
   saw**: for example, "Death certificate No. 4471, seen 12 Nov; copy filed",
   or "Board resolution of 1 Nov appointing Mr Okafor as Treasurer, filed."
   File the document itself in Birr's records. Don't record the evidence without
   having seen it.
4. **Record and notify the contact.** The outgoing contact is told straight
   away and has 7 days to object.

## 2. Proposing the change (Mutawalli Officer)

On the request, press **Propose change**. Before you do:

- **Handover:** confirm by a channel other than the portal, such as a phone
  call, that the contact really asked.
- **Can't act:** check the evidence. You can propose during the 7 days, but
  it can't be approved until they're over.

The page then shows **Awaiting approval** and links to Approvals.

## 3. Approving (Compliance Officer or Board of Trustees)

In **Approvals**, the request shows the outgoing and incoming person, the
reason, the evidence, when the contact was told, and any objection. You
can't approve your own proposal; the database refuses it too.

On approval:

- **New contact already a member:** the change happens at once. After a
  handover, the outgoing contact stays on the team as a **viewer**. When the
  contact can't act, their access is **revoked**.
- **New contact not on Birr yet:** they're emailed an invitation. When they
  accept, they become primary contact. After a handover, the outgoing contact
  stays primary contact until then. When the contact can't act, their access
  is revoked on approval.

Every step is in the audit log (`founder_succession.*`,
`founder_membership.primary_contact_changed`). The Founder's members are told
at each step.

## If the contact objects

**By phone, email or letter:** a Mutawalli Officer opens the request and
presses **Objection received…**. Write what they said, how they reached
Birr, and how you know it was them (for example, you called back the number
on file, or they confirmed their date of birth). It has the same effect as
objecting in the portal, and the note shows "Received by Birr".

Either way, the request shows **Objected** with their note, and can't be approved.
Contact them, and whoever asked, off-platform. Then **Close…** the request
with a note saying what you found. If a change is still needed, someone asks
again.

## Closing or withdrawing

- Whoever asked can withdraw it on their Team page while it's waiting.
- A Mutawalli Officer can **Close…** a waiting or objected request, with a
  note. The Founder's members are told it was closed. They aren't shown the
  note.
- A rejection in Approvals closes it too.

## Rules the system enforces

- One active primary contact per Founder, and one open request per Founder
  (database indexes).
- A "can't act" request needs evidence (database CHECK) and can't be approved
  in the first 7 days or while objected.
- Only the outgoing contact can object for themselves.
- Someone who already has a Birr account must join the team first (invited
  normally), then be picked as an existing member.
- The primary contact role can't be given by an ordinary team invitation.

Permissions: viewing `founder.succession_view` (Mutawalli Officers,
Compliance, Board, Audit Committee); recording and closing
`founder.succession_record` (Mutawalli Officers); the governed
`founder.primary_contact_change` (maker Mutawalli Officer; checkers
Compliance, Board).
