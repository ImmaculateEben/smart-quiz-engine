# Phase 10.5 Security Tests Runbook

This runbook supports roadmap task `10.5 Security Tests` for the `Clavis` app.

## Scope (This Harness)

- Attempt to fetch correct answers from candidate-facing payloads / APIs
- Attempt cross-tenant access (tenant A admin -> tenant B exam export)
- Attempt replay submission (`POST /api/candidate/attempts/[attemptId]/submit`)
- Attempt duplicate attempt submission (concurrent submit requests)
- Attempt timer manipulation (expired attempt save/submit probes)

## Prerequisites

- `clavis` dependencies installed (`npm install`)
- App running locally or deployed (`CLAVIS_BASE_URL`)
- Supabase schema migrated through:
  - `007_attempt_status_submitting_lock.sql`
- Seeded test data:
  - candidate attempt ID for answer-key payload probe (candidate exam page)
  - in-progress attempt for replay/duplicate submit tests
  - expired attempt(s) for timer manipulation probes
  - known `examId` and `questionId` for the expired attempt save probe
- Auth/cross-tenant fixtures:
  - authenticated tenant-A admin session cookie (for cross-tenant export probe)
  - tenant-B `examId` (or another exam outside tenant-A membership)

## Scripts (Node, no extra deps)

- `npm run security:replay-submit`
- `npm run security:duplicate-submit`
- `npm run security:timer`
- `npm run security:answer-key`
- `npm run security:cross-tenant`

All scripts use Node's built-in `fetch` and fixture files.

## Fixtures

- `scripts/security/fixtures/replay-submit.json`
- `scripts/security/fixtures/duplicate-submit.json`
- `scripts/security/fixtures/timer-manipulation.json`
- `scripts/security/fixtures/fetch-correct-answers.json`
- `scripts/security/fixtures/cross-tenant-access.json`

Replace placeholder IDs before running.

## Expected Outcomes

### Fetch correct answers (candidate-facing payload/API probe)

- Candidate exam page payload should render (`200`) and should **not** contain:
  - `correct_answer`
  - `short_answer_rules`
- Optional resume API probe should return a non-`5xx` response and should not contain answer-key fields

### Cross-tenant access (admin API)

- Tenant-A admin probing tenant-B exam export should be blocked with one of:
  - `403 FORBIDDEN`
  - `404 EXAMS_NOT_FOUND`

### Replay submit

- First submit: `200`
- Replay submit: blocked with one of:
  - `400 ATTEMPT_NOT_EDITABLE`
  - `409 SUBMIT_IN_PROGRESS`

### Duplicate submit (concurrent)

- Exactly one request should succeed (`200`)
- Remaining requests should be blocked with:
  - `409 SUBMIT_IN_PROGRESS`, or
  - `400 ATTEMPT_NOT_EDITABLE`

### Timer manipulation

- Save-answer probe on expired attempt should be blocked with:
  - `409 ATTEMPT_EXPIRED`, or
  - `400 ATTEMPT_NOT_EDITABLE`
- Submit probe on expired attempt should result in:
  - `200` with `finalStatus=auto_submitted`, or
  - `400 ATTEMPT_NOT_EDITABLE` if already finalized

## Example Runs

```powershell
$env:CLAVIS_BASE_URL='http://localhost:3000'
npm run security:answer-key
npm run security:cross-tenant
npm run security:replay-submit
npm run security:duplicate-submit
npm run security:timer
```

Concurrent duplicate-submit test with custom burst size:

```powershell
$env:CLAVIS_BASE_URL='http://localhost:3000'
$env:SECURITY_CONCURRENCY='10'
npm run security:duplicate-submit
```

Cross-tenant probe with cookie provided via env var instead of fixture:

```powershell
$env:CLAVIS_BASE_URL='http://localhost:3000'
$env:SECURITY_COOKIE='sb-...=...; ...'
npm run security:cross-tenant
```

## Execution Status (This Session)

Security test harness/scripts were added, but target runs were **not executed** in this session because:

- local app server and seeded security-test fixtures were not provided
- Supabase migrations may not yet be applied in the target runtime

Record actual results here after execution.
