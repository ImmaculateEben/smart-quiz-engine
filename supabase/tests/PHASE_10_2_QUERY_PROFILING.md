# Phase 10.2 Query Profiling

Use `supabase/tests/query_profiling_phase_10_2.sql` to profile the main runtime hot paths covered by the Phase `10.2` optimization pass.

## Scope

- Candidate attempt resume lookup (`exam_attempts` by institution/exam/pin + `started_at`)
- PIN validation failed-attempt rate-limit lookup (`pin_validation_attempts`)
- Integrity review queue listing (`exam_attempts` by tenant + `submitted_at`)
- Platform operations recent finalized attempts list (`exam_attempts` by status + `updated_at`)

## Prerequisites

- Non-production Supabase database with realistic test data volume
- Phase `10.2` index migration applied:
  - `supabase/migrations/008_phase_10_2_performance_indexes.sql`
- Placeholder values filled in `supabase/tests/query_profiling_phase_10_2.sql`

## How to Run

Run in Supabase SQL Editor or `psql` and capture the `EXPLAIN (ANALYZE, BUFFERS)` output.

## What to Record

- Index chosen for each query
- Planning time / execution time
- Rows returned vs rows scanned
- Any remaining sequential scans or sorts
- Follow-up index/query changes required

## Results (fill after execution)

- Date:
- Environment:
- Dataset size summary:

### Resume lookup
- Index used:
- Execution time:
- Notes:

### PIN rate-limit lookup
- Index used:
- Execution time:
- Notes:

### Integrity queue
- Index used:
- Execution time:
- Notes:

### Platform ops recent attempts
- Index used:
- Execution time:
- Notes:

## Outcome

- [ ] Query profiling completed and reviewed
- [ ] Follow-up optimizations identified (if any)
