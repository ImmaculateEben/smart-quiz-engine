# Phase 10.5 Security Tests Runbook

This runbook supports roadmap task `10.5 Security Tests` for the `Clavis` app.

## Scope (This Harness)

- Attempt replay submission (`POST /api/candidate/attempts/[attemptId]/submit`)
- Attempt duplicate attempt submission (concurrent submit requests)
- Attempt timer manipulation (expired attempt save/submit probes)

## Prerequisites

- `clavis` dependencies installed (`npm install`)
- App running locally or deployed (`CLAVIS_BASE_URL`)
- Supabase schema migrated through:
  - `007_attempt_status_submitting_lock.sql`
- Seeded test data:
  - in-progress attempt for replay/duplicate submit tests
  - expired attempt(s) for timer manipulation probes
  - known `examId` and `questionId` for the expired attempt save probe

## Scripts (Node, no extra deps)

- `npm run security:replay-submit`
- `npm run security:duplicate-submit`
- `npm run security:timer`

All scripts use Node's built-in `fetch` and fixture files.

## Fixtures

- `scripts/security/fixtures/replay-submit.json`
- `scripts/security/fixtures/duplicate-submit.json`
- `scripts/security/fixtures/timer-manipulation.json`

Replace placeholder IDs before running.

## Expected Outcomes

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

## Execution Status (This Session)

Security test harness/scripts were added, but target runs were **not executed** in this session because:

- local app server and seeded security-test fixtures were not provided
- Supabase migrations may not yet be applied in the target runtime

Record actual results here after execution.
