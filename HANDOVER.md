# Handover

Every checked item below was exercised by the automated suites listed at the end. "Not verified live" means the code and its boundary exist and were tested against a stand-in, but nothing has talked to the real external service.

## Verified (automated tests, local PostgreSQL 16)

**Onboarding and access (Phase 2)**
- Admin creates tracks, cohorts and ordered modules; first admin is created by a setup command that refuses a second run.
- Student added singly or by CSV. The preview classifies rows (new, new enrolment, already enrolled, duplicate in file, invalid); re-importing the same file changes nothing.
- Permanent student ID (`MSVA-00001`). Activation uses a one-time code emailed through Brevo plus a new password in one step; only the approved enrolment is activated; the student lands on the dashboard (with track and next session when no class exists).
- Resending or correcting an email supersedes the earlier code. Wrong, expired, used and superseded codes get one generic message; five wrong guesses lock a code; a code that Brevo failed to send is discarded so the previous one keeps working.
- Password reset by emailed code (no account enumeration; all sessions revoked), returning sign-in, wrong-password handling.
- Roles, status, track and cohort checked on every request; deactivating a user kills an open session immediately. Removing a tutor keeps classes, quiz links and results.

**Publishing (Phase 3)**
- Drafts save incomplete. Publishing requires title, release time, a valid YouTube link and an individual ClueQuest quiz. Tutors enter the quiz ID (or a ClueQuest address containing it); MSVA checks it with ClueQuest, so unknown, unpublished and unshared quizzes are refused and a room address is not accepted as a quiz; the quiz is locked once students have attempted it (implemented, not separately tested).
- "Create quiz in ClueQuest" saves the draft and opens `CLUEQUEST_AUTHORING_URL` in a new tab; entering the ID shows which quiz is attached. Preview shows the student view without recording anything.
- Students see a class only after release, only in their cohort; other-cohort, draft and unreleased classes all return the same 404.

**Student experience and ClueQuest handoff (Phase 4)**
- Dashboard answers "What do I do next?" with Watch class / Resume class / Take session quiz / Resume session quiz / Retake quiz / Continue / Result pending.
- Viewing progress is saved server-side and resumes; the quiz unlocks at `WATCH_THRESHOLD_PERCENT`.
- Launch verifies enrolment, module unlock, watch threshold and retake eligibility, creates or resumes one attempt, and sends ClueQuest an opaque learner reference (no name or email) with MSVA's attempt id as the assignment. The browser goes to the launch URL in the same tab.
- Signed callbacks (`X-ClueQuest-Signature: v1=` HMAC-SHA256 over timestamp and raw body) are matched to attempt, learner reference and quiz. Bad, stale, mismatched and malformed callbacks are rejected; duplicate event ids and late conflicting results are ignored; a browser return alone never passes a quiz and shows "Result pending" until the callback arrives, and the open page updates by itself.
- Failed attempt → retake (new attempt) until `QUIZ_MAX_ATTEMPTS` is used (default unlimited); MSVA owns that rule and the pass mark (`QUIZ_PASS_MARK_PERCENT`). Optional multiplayer shows a separate "Join live game" link and never replaces the quiz.

**Metrics, progression, certificates (Phase 5)**
- Students see score, pass mark, attempt history. Tutors see enrolled / submitted / passed / outstanding, per-student scores and attempts; retakers count once. Question insights appear only when the callback includes them.
- Module prerequisites are enforced on the server, including direct URLs and the progress and launch endpoints.
- Eligibility and issuance are separate records. A failed PDF render leaves a retryable record (student retry is tested; the admin Retry button calls the same service but has no browser test); one certificate per student and track; download only by its owner; public verification by reference.

**Operations (Phase 6)**
- Admin views: overview, enrolments, progress, scores, certificates, payments; configurable community / WhatsApp / website links (validated as http(s)).
- Sheets sync queue: jobs retry with back-off, a Sheets outage does not block onboarding or quizzes, recovery sends the rows. Tested with an in-memory Sheets client.
- Paystack flow against a test adapter: access unlocks only after server-side verification of status, amount, currency, reference and customer email; a wrong amount is refused; repeated webhooks create one payment and one entitlement; webhook signature (HMAC-SHA512) is checked.

**UI**
- Responsive at phone (Pixel 5 emulation) and desktop sizes; no horizontal overflow on public pages; no gradients; no icons; skip link; labelled fields; visible focus; modals use native `<dialog>`.

## Verified against a real ClueQuest (local, in-process)

A one-off script started MSVA's real `LiveClueQuestClient` against a real ClueQuest server (the sibling `clue-quest` source tree, PGlite) and played through: quiz lookup (unshared and unknown quizzes refused; a quiz address accepted), launch, a failed attempt (3/6 against a 70% pass mark), a retake, a pass, signed deliveries accepted, and one stored event per attempt. See [docs/CLUEQUEST_INTEGRATION.md](docs/CLUEQUEST_INTEGRATION.md). The script is not part of `npm test` because it needs the ClueQuest source tree.

## Not verified live: waiting on credentials or a deployment

| Item | What is missing | What exists |
| --- | --- | --- |
| **ClueQuest, deployed** | A deployed ClueQuest, a partner registered with MSVA's real webhook URL and return origin, and tutors opting quizzes in. | `LiveClueQuestClient` and the webhook receiver, run against a local ClueQuest (above) and unit-tested with a fake `fetch`. |
| **Brevo email** | `BREVO_API_KEY` and a sender verified in Brevo. See [docs/EMAIL.md](docs/EMAIL.md). | `BrevoOtpMailer` (POST `/v3/smtp/email`), unit-tested with a fake `fetch`. Never called against Brevo from the code base; browser and API tests use the database-backed test mailer. |
| **Google sign-in** | OAuth client id and secret. | Authorization-code flow; an invited account whose Google-verified email matches is activated. No test covers it. |
| **Google Sheets** | Service account JSON and a shared sheet with tabs Registrations, Enrolments, Scores. | `GoogleSheetsClient` (JWT bearer, `values:append`), untested against Google. |
| **Paystack (test mode)** | `sk_test_…` key and a webhook URL. | `LivePaystackClient` for initialize/verify, untested against Paystack. No browser test of the premium purchase screens. |
| **Python certificate script** | The script. | Built-in PDF renderer is used. `CERTIFICATE_SCRIPT_PATH` runs a script that reads JSON on stdin and writes PDF bytes to stdout; this contract is an assumption to confirm. |
| **Supabase database** | A project. | Tests ran on local PostgreSQL 16. Use the pooled URL as `DATABASE_URL` and the direct URL as `DIRECT_URL`. Migrations were not applied to Supabase. |
| **YouTube player** | — | The embed with resume and periodic saving is implemented, but headless tests block YouTube and drive progress through the API. Try it once in a real browser. |

## Defaults I chose (all reversible)

- Watch threshold 80%, pass mark 70%, unlimited retakes, sessions 14 days. Activation codes last 72 hours and reset codes 60 minutes. ClueQuest launch links last 15 minutes (its setting).
- A module unlocks when every published class in earlier modules (for the student's cohort) is passed. A track is complete when all its published classes are passed and, if a final-assessment module exists, it has content. Mark the final module with "This module holds the final assessment".
- Any tutor currently assigned to a track can edit and view that track's classes.
- A student deactivated and later reactivated keeps all results.
- Buying a premium course creates an entitlement and, if absent, an active enrolment in that track's earliest cohort. Only students with an active enrolment can purchase.
- Sheets sync appends rows (Registrations, Enrolments, Scores); a retry after a partial failure could append a row twice.

## Known limitations

- Viewing progress is reported by the browser, so a determined student can send a fake position. Real enforcement needs player telemetry or ClueQuest-side checks.
- Rate limiting is in memory (single instance). Run one API instance or move it to a shared store.
- ClueQuest's webhook carries totals only, so tutors see scores and attempts but no per-question insight.
- No accessibility audit tool was run; keyboard, focus, labels and overflow were checked in tests only.
- Deprecation warning from `pg` ("client.query() when already executing a query") appears in logs; it is harmless and comes from the driver adapter.

## Test results (last run)

| Check | Result |
| --- | --- |
| `npm run lint` (web + API) | clean |
| `npm run typecheck` (web + API) | clean |
| `npm run build` (Next.js production build, 26 routes) | passes |
| `npm run test:api` (Vitest + Supertest) | 33 passed |
| `npm run test:e2e` (Playwright, desktop 1280×800 and Pixel 5) | 42 passed (21 per project) |

The acceptance journey (admin invites student → student activates with the emailed code → tutor publishes class with video and individual quiz → student reaches the quiz threshold → launches ClueQuest as a guest → signed result reaches MSVA → tutor sees the same 8/10 → next class unlocks) is `e2e/journey.spec.ts`. Edge cases (expired code, password reset by code, duplicate CSV, missing quiz link, other-cohort and locked-module access, failed attempt and retake, delayed and duplicate callbacks, optional multiplayer, deactivation of an open session, role redirects) are in `e2e/edge.spec.ts` and `server/tests/`.
