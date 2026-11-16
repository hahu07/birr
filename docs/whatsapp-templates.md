# WhatsApp message templates

Birr sends WhatsApp messages for verification codes, gift and zakah receipts, zakah refund updates, monthly-giving updates, and account notices to staff and founders.

From Twilio's **sandbox** sender, these go out as plain text. From Birr's **real** WhatsApp number, WhatsApp only delivers messages Birr starts if they use a **template Meta has approved**. This guide covers getting the six templates below approved and switched on.

Until a template is switched on, the backend handles messages of that kind like this:
- **Sandbox sender:** sends plain text, as it does today.
- **Real sender:** refuses, and logs `No approved WhatsApp template for "<kind>"`. Nothing reaches WhatsApp, so there's no silent failure and no charge.

## Steps

1. **Verify Birr's business with Meta.** This is done once, in Meta Business Manager. Templates can't be approved until the business is verified.
2. **Register Birr's WhatsApp number as a sender in Twilio:** Messaging → Senders → WhatsApp senders. This links Twilio to Birr's WhatsApp Business account.
3. **Create each template below in Twilio's Content Template Builder:** Messaging → Content Template Builder → Create new.
   - Use the **name**, **language** and **body** exactly as given. Add the sample values when asked; Meta reviews them.
   - **`birr_verification_code`:** choose the **Authentication** content type. Turn on the copy-code button, the security note and a 10-minute expiry. Meta fixes this wording itself.
   - **The other five:** choose **Text**, and submit them in the **Utility** category. They are transactional, never promotional.
4. **Submit each one for WhatsApp approval** from the builder. Approval usually comes back within minutes to a day.
5. **Switch each approved template on.** Copy its **Content SID** (it starts with `HX`). In Ops Console → Settings → Twilio, paste it into the matching *WhatsApp template SID* field. It takes effect at once, with no restart.
6. **Set *WhatsApp from number*** in the same section to Birr's real number.
7. **Test** with your own number:
   - give a small gift with a WhatsApp receipt;
   - confirm a number on the giving page, which sends a verification code;
   - check a staff notice reaches a verified staff number.

**If Meta rejects a template,** change the wording in `apps/backend/src/common/whatsapp/whatsapp-templates.ts`, then update this file to match. A test fails if the two differ. Resubmit the changed template.

## The templates

The rules these follow:
- **Values:** each one is filled in by the backend on one line. Line breaks are turned into " · ", and an empty value becomes "—".
- **Layout:** no template starts or ends with a value, or puts two values side by side, except the authentication one, whose wording Meta sets.

### `birr_verification_code`

- **Category:** Authentication
- **Language:** English
- **Platform Settings field:** Twilio → `TEMPLATE_VERIFICATION_CODE`

Body:

```
{{1}} is your verification code. For your security, do not share this code. This code expires in 10 minutes.
```

| Variable | What it holds | Sample |
| --- | --- | --- |
| `{{1}}` | code | 482913 |

### `birr_gift_receipt`

- **Category:** Utility
- **Language:** English
- **Platform Settings field:** Twilio → `TEMPLATE_GIFT_RECEIPT`

Body:

```
Thank you for your gift to Birr.

We received {{1}} for {{2}}.

Receipt reference: {{3}}

— Birr, a digital trustee for Islamic waqf
```

| Variable | What it holds | Sample |
| --- | --- | --- |
| `{{1}}` | amount | ₦10,000.00 |
| `{{2}}` | what it was given to | Ramadan Relief Vault (Food parcels) |
| `{{3}}` | reference | 3f2c9a1e-5b7d-4e2a-9c1f-6d8e2b4a7c90 |

### `birr_zakah_receipt`

- **Category:** Utility
- **Language:** English
- **Platform Settings field:** Twilio → `TEMPLATE_ZAKAH_RECEIPT`

Body:

```
Your zakah payment to Birr is received.

We received {{1}}. All of your zakah goes to people eligible to receive it.

Receipt reference: {{2}}

— Birr, a digital trustee for Islamic waqf
```

| Variable | What it holds | Sample |
| --- | --- | --- |
| `{{1}}` | what was received | ₦95,000.00 of zakah, and ₦1,548.23 you added to cover the processing fee |
| `{{2}}` | reference | 3f2c9a1e-5b7d-4e2a-9c1f-6d8e2b4a7c90 |

### `birr_zakah_refund_update`

- **Category:** Utility
- **Language:** English
- **Platform Settings field:** Twilio → `TEMPLATE_ZAKAH_REFUND_UPDATE`

Body:

```
An update on your zakah refund from Birr:

{{1}}

Refund reference: {{2}}

— Birr, a digital trustee for Islamic waqf
```

| Variable | What it holds | Sample |
| --- | --- | --- |
| `{{1}}` | the update | Birr will refund ₦12,000.00 to your account ending 6789. |
| `{{2}}` | reference | 3f2c9a1e-5b7d-4e2a-9c1f-6d8e2b4a7c90 |

### `birr_monthly_gift_update`

- **Category:** Utility
- **Language:** English
- **Platform Settings field:** Twilio → `TEMPLATE_MONTHLY_GIFT_UPDATE`

Body:

```
An update on your monthly giving with Birr.

*{{1}}*
Details: {{2}}

Manage it here: {{3}}

— Birr, a digital trustee for Islamic waqf
```

| Variable | What it holds | Sample |
| --- | --- | --- |
| `{{1}}` | title | Your next monthly gift |
| `{{2}}` | details | On 15 December we'll charge ₦10,000 to Ramadan Relief to your Visa card ending 4081. |
| `{{3}}` | link | https://birrwaqf.org/giving/manage/abc123 |

### `birr_account_notice`

- **Category:** Utility
- **Language:** English
- **Platform Settings field:** Twilio → `TEMPLATE_ACCOUNT_NOTICE`

Body:

```
You have a new notice from Birr.

*{{1}}*
Details: {{2}}

View it in Birr: {{3}}

— Birr, a digital trustee for Islamic waqf
```

| Variable | What it holds | Sample |
| --- | --- | --- |
| `{{1}}` | title | A proposal needs your approval |
| `{{2}}` | details | A Mutawalli Officer proposed approving a distribution of ₦250,000.00. |
| `{{3}}` | link | https://birrwaqf.org/ops/governed-actions |

