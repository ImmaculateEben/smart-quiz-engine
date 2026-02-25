# Phase 7.5 Load Testing Runbook

This runbook supports roadmap task `7.5 Load Testing` for the `Clavis` app.

## Scope

- `POST /api/pins/validate` at target scale (`1000` validations)
- `POST /api/candidate/attempts/[attemptId]/submit` at target scale (`500` submissions)

## Prerequisites

- `clavis` dependencies installed (`npm install`)
- App running locally or deployed (`CLAVIS_BASE_URL`)
- Supabase schema migrated through:
  - `004_attempt_integrity_events.sql`
- Seeded/load-test data:
  - published exam with question set
  - active PIN(s)
  - pre-created in-progress attempts for submission test

## Scripts (Node, no extra deps)

- `npm run load:pin`
- `npm run load:submit`

Both scripts use Node's built-in `fetch` and environment variables.

## Fixtures

- `scripts/load/fixtures/pin-validate.json`
- `scripts/load/fixtures/submit-attempt.json`

Replace placeholder IDs before running.

## Example Runs

### 1000 PIN validations

```powershell
$env:CLAVIS_BASE_URL='http://localhost:3000'
$env:LOAD_CONCURRENCY='100'
$env:LOAD_TOTAL_REQUESTS='1000'
node scripts/load/pin-validate.mjs
```

### 500 submissions

```powershell
$env:CLAVIS_BASE_URL='http://localhost:3000'
$env:LOAD_CONCURRENCY='50'
$env:LOAD_TOTAL_REQUESTS='500'
node scripts/load/submit-attempt.mjs
```

## Metrics to Capture

- Success rate (`2xx` vs non-`2xx`)
- Latency (`avg`, `p50`, `p90`, `p95`, `p99`)
- Throughput (`req/s`)
- Error status distribution (`400/409/429/500`)
- DB CPU / query latency (Supabase dashboard)

## Bottleneck Checklist

- `pin_validation_attempts` insert contention/rate-limit queries
- `exam_pins` update contention on `uses_count`
- `exam_results` upsert latency on submit
- Analytics updates in submit flow (`exam_analytics_daily`, `question_analytics`)
- Integrity event reads during submit scoring

## Optimization Follow-ups (if needed)

- Add/adjust indexes for hot predicates in validation and submission paths
- Reduce round trips in submit flow (batch RPC / SQL function)
- Split synchronous analytics writes into background jobs
- Improve idempotency handling to avoid duplicate analytics work

## Execution Status (This Session)

Load-test harness/scripts were added, but target runs were **not executed** in this session because:

- `clavis` dependencies are not installed
- local app server is not running with seeded load-test fixtures

Record actual results here after execution.
