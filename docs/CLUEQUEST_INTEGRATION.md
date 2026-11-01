# ClueQuest integration

MSVA owns enrolment, classes, access, progress and certificates. ClueQuest owns quiz creation, the quiz-taking screens, marking and (optionally) live multiplayer rooms. MSVA talks to ClueQuest's **partner API v1**; the full contract is `docs/PARTNER_INTEGRATION.md` in the ClueQuest repository.

## One-time setup

1. In ClueQuest, register MSVA as a partner:

   ```bash
   npm run partner:create -- --slug msva --name "MS Virtual Academy" \
     --webhook https://<api-domain>/api/webhooks/cluequest/result \
     --return https://<web-domain>
   ```

   It prints the **API key** and **webhook secret** once. `--return` must be MSVA's `APP_URL` origin, otherwise ClueQuest refuses MSVA's `returnUrl` with `422`.
2. Put them in MSVA's `server/.env`:

   | Variable | Value |
   | --- | --- |
   | `CLUEQUEST_ADAPTER` | `live` |
   | `CLUEQUEST_API_URL` | ClueQuest API origin |
   | `CLUEQUEST_API_KEY` | the partner API key |
   | `CLUEQUEST_WEBHOOK_SECRET` | the webhook secret |
   | `CLUEQUEST_BASE_URL` | ClueQuest web origin (multiplayer room links must be on it; quiz addresses pasted by tutors are checked against it) |
   | `CLUEQUEST_AUTHORING_URL` | page opened by "Create quiz in ClueQuest" |
   | `QUIZ_PASS_MARK_PERCENT` | MSVA's pass mark, default 70 |
   | `QUIZ_MAX_ATTEMPTS` | attempts per class, `0` = unlimited retakes (default) |

3. Each quiz's owner ticks **Let connected learning platforms assign this quiz** on its *Use* page. Until then ClueQuest answers `404` and MSVA tells the tutor so.

## How a class uses a quiz

| Step | What happens |
| --- | --- |
| Tutor attaches a quiz | They paste the **quiz ID** (or a ClueQuest address containing it). MSVA calls `GET /api/partner/v1/quizzes/{id}` and accepts it only if it exists, is published, is shared with partners and can be played solo. The title is stored. |
| Student unlocks the quiz | After `WATCH_THRESHOLD_PERCENT` of the video and any module prerequisites. |
| Student presses "Take session quiz" | MSVA creates (or resumes) one `QuizAttempt` and calls `POST /api/partner/v1/launches` with `quizId`, `assignmentRef` = MSVA's attempt id, `learnerRef` = an opaque random reference (no name or email), `returnUrl` = `<APP_URL>/classes/<id>?returned=1`, and `activity` = `solo`, `points`, `passMarkPercent`, `attemptLimit: 1`. The student is redirected to the returned `launchUrl` in the same tab. |
| Student finishes | ClueQuest shows the result and **Return to class**. Returning only shows "Result pending". |
| Result arrives | ClueQuest `POST`s `attempt.submitted` to `/api/webhooks/cluequest/result`. MSVA verifies the signature, matches `partnerAssignmentRef` + `learnerRef` + `quizId` to the attempt, stores marks, and unlocks what comes next. |
| Retake | A new MSVA attempt, so a new `assignmentRef`. MSVA, not ClueQuest, decides how many attempts a student gets (`QUIZ_MAX_ATTEMPTS`). |

Using the MSVA attempt id as `assignmentRef` keeps the mapping one-to-one: ClueQuest pins the quiz version and rules per assignment, resumes an unfinished attempt if the student reopens the link, and never creates a second attempt for the same one.

## Result callback

`POST /api/webhooks/cluequest/result`, raw JSON body, headers:

```
X-ClueQuest-Event-Id: evt_<attemptId>
X-ClueQuest-Timestamp: <unix seconds>
X-ClueQuest-Signature: v1=<hex HMAC-SHA256(CLUEQUEST_WEBHOOK_SECRET, "<timestamp>.<raw body>")>
```

- Rejected with `401` if the signature is wrong or the timestamp is more than 5 minutes old.
- Rejected with `422` if the attempt, learner reference or quiz do not match what MSVA launched.
- A repeated `eventId` returns `200 {"outcome":"duplicate"}`. A second, different result for an already-resolved attempt returns `200 {"outcome":"ignored"}`. ClueQuest retries any non-2xx with back-off, so these are 200 to stop retries.
- Stored: `marksEarned` → score, `marksPossible` → maximum, `passed` (ClueQuest decides it from marks and the pass mark MSVA sent), `attemptId` → `providerAttemptId`. MSVA's pass mark in marks is `marksPossible × passMarkPercent / 100`.

## What ClueQuest does not provide

- **Per-question detail.** The webhook carries totals only, so tutors see scores and attempts but no question-by-question insight.
- **A retake policy.** MSVA owns it (above).
- **Multiplayer through MSVA.** The optional "Join live game" link is just a ClueQuest room address (`/join/<code>`) on `CLUEQUEST_BASE_URL`, opened in a new tab. It never replaces the individual quiz.

## Verified

The behaviour above was run against a real ClueQuest server (the sibling `clue-quest` repository, in-process with PGlite): the quiz lookup rules (unshared and unknown quizzes refused), a real launch, a failed first attempt (3/6 against 70%), a retake, a pass, signed deliveries accepted, and exactly one stored event per attempt. That check is a one-off script, not part of `npm test`, because it needs the ClueQuest source tree. It has **not** been run against a deployed ClueQuest.
