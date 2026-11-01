# Email

MSVA sends two kinds of email, both carrying a **6-digit one-time code**: an activation code (when an admin adds a student or tutor, resends, or corrects an email) and a password reset code. There are no invitation or reset links to click. Brevo only delivers the message; MSVA generates the code, stores a hash of it and checks it.

## How it works

| Moment | What happens |
| --- | --- |
| Admin adds a student or tutor, resends an invite, or corrects an email | MSVA creates a code (valid `ACTIVATION_CODE_TTL_HOURS`, default 72) and sends it with Brevo's `POST /v3/smtp/email`. The email also links to `/activate?email=…` with the address pre-filled. |
| Person opens `/activate`, enters email, code and a password | `POST /api/auth/verify-otp` checks the code, sets the password, activates the account and signs them in. |
| Person asks for a reset on `/forgot-password` | `POST /api/auth/otp/request` sends a code (valid `RESET_CODE_TTL_MINUTES`, default 60) only if the address belongs to an active account. |
| Person enters the code and a new password on `/reset-password` | `POST /api/auth/verify-otp` (`purpose: "reset"`) sets the password and ends every open session. |

Behaviour you can rely on:

- `otp/request` always answers `202 {"ok":true}`, whether or not the address belongs to an eligible account.
- Wrong, expired, used and superseded codes all give the same message, "That code is not correct or has expired."
- A newer code replaces the earlier one, but only after Brevo has accepted the newer one. If Brevo rejects the send, that code is discarded and the earlier one keeps working.
- Five wrong guesses lock a code. A weak password is rejected before the code is checked, so it does not use the code up.
- The activation and reset pages both have **Send me a new code**.
- Google sign-in can also activate an invited account: Google has verified the address and an admin invited it, so no code is needed.
- MSVA keeps only metadata about each message (recipient, subject, status, error). The body holds the code, so it is not stored.

## Set up Brevo

1. In Brevo, create an API key: **SMTP & API → API Keys**.
2. Add and verify a sender: **Senders, Domains & Dedicated IPs → Senders**. The address must be verified, and mail from a Gmail or other free-mail address is likely to land in spam. For real use, verify a domain you own (add the DNS records Brevo gives you).
3. Set these on the API host:

```
EMAIL_ADAPTER=brevo
BREVO_API_KEY=
EMAIL_FROM_ADDRESS=      # the verified sender
EMAIL_FROM_NAME=MS Virtual Academy
ACTIVATION_CODE_TTL_HOURS=72
RESET_CODE_TTL_MINUTES=60
```

The API refuses to start in production with `EMAIL_ADAPTER=brevo` unless the key and sender are set. `EMAIL_ADAPTER=test` (development and automated tests only, refused in production) stores codes in the `OtpCode` table and records each message in `EmailMessage`, so tests read the code from `GET /api/test/emails?to=…&kind=otp`.

If an email does not arrive, check the `EmailMessage` table: `status` is `sent` or `failed`, and a failure has the Brevo status code in `error`. The admin screens also show "Saved, but the email could not be sent" and offer **Resend invite**.

## Not verified live

`BrevoOtpMailer` is covered by unit tests with a fake `fetch` (URL, headers, sender, recipient, code present in the message, failures, and replacement behaviour) but has not been called against Brevo. The first real send will show whether the sender is verified and the message is delivered.
