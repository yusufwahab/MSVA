# Email with Supabase Auth

MSVA sends **no email of its own**. Account activation and password reset both use a one-time code that Supabase Auth generates, emails and checks. There is no invitation link and no reset link.

## How it works

| Moment | MSVA | Supabase Auth |
| --- | --- | --- |
| Admin adds a student or tutor, resends an invite, or corrects an email | `POST {SUPABASE_URL}/auth/v1/otp` with `{ email, create_user: true }` | Emails a 6-digit code |
| Person opens `/activate`, enters email, code and a new password | `POST /api/auth/verify-otp` → `POST {SUPABASE_URL}/auth/v1/verify` with `{ type: "email", email, token }` | Accepts or rejects the code |
| Person asks for a reset on `/forgot-password` | `POST /api/auth/otp/request` (`purpose: "reset"`) → same `/auth/v1/otp` call | Emails a code |
| Person enters the code and a new password on `/reset-password` | `POST /api/auth/verify-otp` (`purpose: "reset"`) | Accepts or rejects the code |

Only the project's public **anon key** is used. MSVA keeps its own users, passwords and sessions; Supabase Auth is used purely as the code mailer, so a Supabase user row is created for each address as a side effect and is otherwise unused.

Behaviour you can rely on:

- `otp/request` always answers `202 {"ok":true}`, whether or not the address belongs to an eligible account, and sends nothing for an address that is not an invited account (activation) or an active account (reset).
- A wrong, expired, used or superseded code all produce the same message, "That code is not correct or has expired." Supabase does not say which.
- A weak password is rejected before the code is checked, so it does not use the code up.
- The activation page and reset page both have **Send me a new code**. A newer code replaces the earlier one.
- Resetting a password signs the person out everywhere.
- Google sign-in can also activate an invited account: Google has verified the address and an admin invited it, so no code is needed.

## Configure the Supabase project

In the Supabase dashboard:

1. **Authentication → Providers → Email**: enable it. Set **OTP expiry** (default 3600 s; the old invitation link lasted 72 hours, so consider 86400 s) and **OTP length** 6.
2. **Authentication → Email Templates**: the code is only in the email if the template contains `{{ .Token }}`. Edit **both** *Confirm signup* (used the first time an address is seen) and *Magic Link* (used for addresses Supabase already knows, such as password resets). Use the same text in both, for example:

   > **Subject:** Your MS Virtual Academy code
   >
   > Your code is **{{ .Token }}**.
   >
   > Enter it on the MS Virtual Academy page where you asked for it: {{ .SiteURL }}/activate to activate a new account, or {{ .SiteURL }}/reset-password to choose a new password. If you did not ask for this, ignore this email.

   Do not use `{{ .ConfirmationURL }}`: MSVA does not handle Supabase's links.
3. **Authentication → URL Configuration**: set **Site URL** to MSVA's `APP_URL`.
4. **Authentication → SMTP Settings**: Supabase's built-in sender is for testing only; it allows a handful of emails per hour and may only send to your team's addresses. For real students, add a custom SMTP provider here (any provider works; it is configured in Supabase, not in MSVA). Also check **Rate Limits**: Supabase allows one code email per address every 60 seconds.
5. Copy **Project URL** and the **anon public** key (Project Settings → API).

## MSVA variables

```
EMAIL_ADAPTER=supabase
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<anon public key>
```

`EMAIL_ADAPTER=test` (development and automated tests only, refused in production) stores codes in the `OtpCode` table and records each message in `EmailMessage`, so tests read the code from `GET /api/test/emails?to=…&kind=otp`.

## Not verified live

The Supabase calls are covered by unit tests with a fake `fetch` (URL, headers, body, and how each status is treated) but have **not** been run against a real Supabase project. The details that matter when you first try it: the template edits above, the SMTP/rate-limit settings, and that `create_user: true` plus `type: "email"` behave as documented for both a new address and a returning one.
