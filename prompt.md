Build the MSVA Student Portal for MS Virtual Academy. This prompt is the complete project brief. You do not need access to a separate Word document. Implement the application in the repository, starting from its current state.

PROJECT GOAL

MSVA is an invite-only learning portal. The academy enrols students into tracks and cohorts. Tutors publish scheduled video classes. After every class, the student takes a required individual quiz on Elim, a separate platform. The result returns to MSVA, updates the student’s progress, and determines whether the next module unlocks. Students who complete all requirements can download a certificate.

MSVA owns enrolment, classes, access permissions, progress, and certificates. Elim owns quiz creation, attempts, grading, retake rules, and multiplayer rooms. Build the MSVA side only.

HOW TO WORK

Inspect the repository first. Reuse working code and implement the phases below in order. After each phase, run the relevant checks, fix failures, and continue automatically. Do not ask for approval between phases. For unspecified details, choose a safe, reversible default and record it in the handover.

Use local development or free-tier services. Do not purchase services or use live payments. If an external credential or API is unavailable, build and test the integration boundary, continue with other phases, and identify exactly what is required for live operation. Never present a simulated result as a verified live integration.

APPROVED STACK

- Frontend: Next.js with React, TypeScript, and Tailwind CSS.
- Backend: Node.js with Express, TypeScript, and Zod.
- Database: Supabase PostgreSQL with Prisma and versioned migrations.
- Transactional email: Brevo, called from Express.
- Testing: Playwright for browser journeys and Supertest for API behaviour.
- Keep database credentials, email keys, and integration secrets server-side.

PHASE 1 — PUBLIC LANDING PAGE AND UI FOUNDATION

Create a responsive public landing page for MS Virtual Academy. Explain how the academy works in plain language: join an assigned track, watch tutor-led sessions, take a quiz after each session, and earn a certificate. The primary action for existing students is “Student sign in”. Invited students should also be able to find “Activate account”. Do not imply that anyone can self-enrol. Do not invent testimonials, enrolment figures, or partnerships.

Give the site a polished academic identity using strong typography, restrained solid colours, generous spacing, and clear hierarchy. No gradients or decorative icon clutter. The landing page should feel welcoming; the signed-in portal should prioritise the user’s next action. Design for small phones, tablets, and desktops. Include keyboard navigation, visible focus indicators, labelled fields, and clear loading, empty, error, and success states.

PHASE 2 — ADMIN, INVITATIONS, AND SIGN-IN

Provision the first admin through a secure setup command. Admins create tracks such as Front-End Development, Graphic Design, or Cybersecurity, then create cohorts within each track. Tutors and students cannot select their own roles.

Student onboarding:

1. An admin adds a student’s name, email, track, and cohort individually or by CSV. Preview invalid rows and duplicates before importing. Re-importing a file must not duplicate enrolments.
2. Create a permanent student ID and email a separate, single-use, expiring activation link through Brevo.
3. The student opens the link, sees their invited email, and sets a password. Support Google sign-in if configured, requiring the same verified email.
4. Activate only the approved enrolment and send the student directly to their dashboard. If no class is available, show the assigned track and next session date if known.
5. Support returning sign-in, password reset, invite resend, and admin correction of an incorrect email. Reissuing access invalidates the previous invitation.

Tutor onboarding:
The admin invites a tutor by email and assigns one or more tracks. After activation, the tutor sees only assigned teaching areas. Removing a tutor must preserve published classes, assessments references, and student results.

Enforce role, account status, track, and cohort permissions on every relevant API request. Deactivation must revoke access even for an existing session.

PHASE 3 — TUTOR CLASS PUBLISHING

Provide “My classes”, a class editor, drafts, scheduling, and a preview. Each class belongs to a track, cohort, and ordered module.

The editor includes title, description, release date, YouTube video link, required individual Elim quiz link, and optional multiplayer room link. Both the video and individual quiz are compulsory for publication. Incomplete drafts can be saved.

Beside the quiz field, provide “Create quiz in Elim”. Open the configured Elim authoring page in a new tab and preserve the MSVA draft. The tutor creates the questions in Elim, returns to MSVA, pastes the quiz link, and sees which quiz is attached. Validate the approved Elim origin and quiz type through its documented API when available. A multiplayer room link cannot satisfy the individual quiz requirement.

Students see the published class only after its release time and only within the correct track and cohort.

PHASE 4 — STUDENT EXPERIENCE AND ELIM INTEGRATION

The dashboard should answer “What do I do next?” Show the current class, progress, and a primary action: Watch class, Resume class, Take session quiz, Retake quiz, or Continue.

Embed the class video, save viewing progress, and resume after an interruption. Use a configurable watch threshold to unlock the quiz action. Once eligible, the student taps “Take session quiz” and goes directly to that quiz on Elim in the same tab. No Elim account, name entry, or room code is required.

Implement the handoff as follows:

- Configure ELIM_BASE_URL and any separate authoring URL, API URL, or server credentials through environment variables. Do not hardcode a guessed Elim domain.
- Store the individual quiz reference on each class. The base URL alone cannot identify a class quiz or report a student result.
- On launch, Express verifies enrolment, viewing progress, and attempt eligibility. Create or resume an attempt reference tied to this student, class, and quiz. Request a short-lived guest launch link from Elim using an opaque student reference.
- Accept signed result callbacks from Elim. Match the callback to the expected attempt and quiz, store the outcome, and safely handle retries or duplicates. A browser redirect alone cannot mark a quiz as passed.
- Return the student to the exact MSVA class. If the result is delayed, show “Result pending”. When it arrives, update progress even if the student has closed the tab.
- If an optional live room exists, show “Join live game” separately. Students enter Elim as guests. Multiplayer never replaces the required individual quiz.

Use the real Elim contract if available. If it has not yet been supplied, document the exact launch and result capabilities needed from Elim. Build a test-only adapter for automated tests. Do not invent live endpoints or build a second quiz engine in MSVA.

PHASE 5 — METRICS, PROGRESSION, AND CERTIFICATES

Students see their own score, pass mark, attempt history, and next action. Tutors see results for assigned classes: enrolled versus submitted, students outstanding, individual scores, and attempts. Count a student once in completion totals even if they retake the quiz. Show question-level insights only when Elim supplies that information.

Enforce module prerequisites on the server, including direct URL access. Passing unlocks the next module; a failed attempt follows Elim’s retake policy. Once the student passes all required modules and the final assessment, issue one downloadable certificate with their student ID and a verification reference. Integrate the academy’s existing Python certificate script if provided. Keep eligibility and issuance records separate so a failed PDF generation can be retried safely.

PHASE 6 — ACADEMY OPERATIONS

Add admin views for enrolments, progress, scores, certificates, and payments. Keep community, WhatsApp support, and academy website links configurable.

Implement one-way Google Sheets sync for registrations, enrolment changes, and final scores. Supabase PostgreSQL remains the source of truth. Use retryable jobs so a Sheets outage does not interrupt onboarding or assessments.

For premium courses, implement Paystack in test mode. Default to enrolled students purchasing access. Unlock the correct course only after server-side verification of the payment, amount, currency, and student. Handle repeated notifications without duplicate purchases.

PHASE 7 — TEST AND HAND OVER

Run lint, TypeScript checks, production builds, API tests, and Playwright at phone and desktop sizes. The main acceptance test is one complete journey:

Admin invites student → student activates → tutor publishes class with video and individual quiz → student completes video → launches Elim as a guest → result reaches MSVA → tutor sees the same score → next class unlocks.

Also test expired invites, duplicate CSV imports, missing quiz links, unauthorised cohort access, failed attempts, delayed and duplicate callbacks, and optional multiplayer participation. Use a test email adapter for repeatable browser tests and Brevo for configured delivery.

Deliver working code, migrations, an .env.example without secrets, setup commands, test results, and a concise handover distinguishing verified features from integrations awaiting credentials or an external contract. Continue through all phases without waiting for my approval.
