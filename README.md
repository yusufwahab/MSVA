# MSVA Student Portal

Invite-only learning portal for MS Virtual Academy. Students watch tutor-led YouTube classes, take an individual quiz on ClueQuest after each one, and earn a certificate. MSVA owns enrolment, classes, access, progress and certificates; ClueQuest owns quiz creation, the quiz screens, marking and multiplayer rooms; Brevo emails the one-time codes.

| Part | Location | Stack |
| --- | --- | --- |
| Web app | `app/`, `components/`, `lib/` | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| API | `server/` | Node.js, Express 5, TypeScript, Zod |
| Data | `server/prisma/` | PostgreSQL (Supabase) via Prisma 7, versioned migrations |
| Browser tests | `e2e/` | Playwright (desktop and phone projects) |
| API tests | `server/tests/` | Vitest + Supertest |

The browser only talks to the Next.js origin. `/api/*` is proxied to Express (`next.config.ts`), so session cookies are first-party and no secret reaches the client.

Read [HANDOVER.md](HANDOVER.md) for what is verified and what is waiting on credentials, [docs/CLUEQUEST_INTEGRATION.md](docs/CLUEQUEST_INTEGRATION.md) for how quizzes connect, and [docs/EMAIL.md](docs/EMAIL.md) for the email codes.

## Setup

Requirements: Node 22+, a PostgreSQL database (a free Supabase project, or any local PostgreSQL 14+).

```bash
npm run install:all                 # web + server dependencies (also generates the Prisma client)
cp server/.env.example server/.env  # then fill in DATABASE_URL and DIRECT_URL at minimum
cp .env.example .env                # optional: only API_ORIGIN
npm run db:migrate                  # apply versioned migrations
npm run setup:admin -- --email you@example.com --name "Your Name"   # asks for the password at a hidden prompt
```

`setup:admin` creates the first admin and refuses to run again once one exists (`--additional` overrides). The password comes from a hidden prompt or `ADMIN_PASSWORD`, never from an argument.

For local exploring without any external service, set these in `server/.env`:

```
EMAIL_ADAPTER=test
CLUEQUEST_ADAPTER=test
CLUEQUEST_BASE_URL=https://cluequest.test
CLUEQUEST_AUTHORING_URL=https://cluequest.test/quizzes/new
CLUEQUEST_WEBHOOK_SECRET=local-secret
PAYSTACK_ADAPTER=test
PAYSTACK_SECRET_KEY=sk_test_local
ENABLE_TEST_ENDPOINTS=1
```

One-time codes are then stored in the database and the "emails" are recorded in it (`GET /api/test/emails?to=...&kind=otp`) instead of being sent. These test adapters are refused when `NODE_ENV=production`.

## Run

```bash
npm run dev:api   # Express on :4000
npm run dev       # Next.js on :3000
```

## Checks

```bash
npm run lint
npm run typecheck
npm run build
npm run test:api     # needs a database named msva_test, or TEST_DATABASE_URL
npm run test:e2e     # needs a database named msva_e2e, or E2E_DATABASE_URL; builds and serves the app itself
```

The default test URLs assume `postgresql://msva:msva_dev_pw@localhost:54329/...`. Override with the variables above. The e2e run wipes its database, so never point it at real data.

## Design system

Black and gold, dark by default with a light mode (the sun/moon button in every header; the choice is saved in the browser).

- Tokens live in `app/globals.css`: `--c-*` variables per theme, mapped to Tailwind names such as `bg-canvas`, `bg-surface`, `text-accent-ink`. Components never use raw colours, so a new theme only changes that file.
- Font: Plus Jakarta Sans (`app/layout.tsx`). Shared pieces: `components/ui.tsx` (buttons, fields, cards, tables, modals), `components/AppShell.tsx` (top bar for students and tutors, sidebar for admins), `components/Public.tsx` (public header, footer, split sign-in layout), `components/Brand.tsx` (logo, theme toggle).
- The landing photo is `public/hero-student.webp`, made from `MS_HERO_IMG.png` (kept in the repo root as the source).
- To review every screen in both themes: `VISUAL=<folder> npx playwright test e2e/visual.spec.ts` writes screenshots there.

## Roles and areas

- **Admin** (`/admin`): tracks, cohorts, ordered modules, students (single add, CSV import with preview, resend invite, correct email, deactivate), tutors and their tracks, reports, certificates, payments, links, Sheets sync.
- **Tutor** (`/tutor`): My classes, class editor with drafts, scheduling, preview, publish; per-class results.
- **Student** (`/dashboard`): next action, class page with video and quiz handoff, results and certificate, premium courses.
- **Public**: landing page, sign in, activate, password reset, certificate verification at `/verify/<reference>`.
