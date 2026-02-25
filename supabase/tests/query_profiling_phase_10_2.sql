-- Clavis Phase 10.2 Query Profiling Scaffold
-- Run manually in Supabase SQL Editor or psql against a non-production environment.
-- Goal: confirm index usage for the primary runtime hot paths optimized in Phase 10.2.

-- ============================================================================
-- PLACEHOLDERS (replace before running)
-- ============================================================================
-- <institution_id>
-- <exam_id>
-- <pin_id>
-- <candidate_client_ip>  -- e.g. 203.0.113.10
-- <rate_limit_since_iso> -- e.g. 2026-02-25T12:00:00.000Z

-- Optional:
-- set local statement_timeout = '15s';

-- ============================================================================
-- CHECK NEW INDEXES EXIST (Phase 10.2 migration 008)
-- ============================================================================
select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'idx_exam_attempts_resume_lookup',
    'idx_exam_attempts_status_updated',
    'idx_exam_attempts_institution_submitted_at',
    'idx_pin_validation_attempts_failed_ip_created'
  )
order by indexname;

-- ============================================================================
-- 1) Candidate resume hot path
-- Route: POST /api/candidate/attempts/resume
-- Query pattern:
--   where institution_id = ? and exam_id = ? and pin_id = ?
--   order by started_at desc limit 20
-- ============================================================================
explain (analyze, buffers, verbose)
select id, candidate_id, status, started_at, expires_at, last_saved_at, current_question_index, attempt_metadata, submitted_at
from public.exam_attempts
where institution_id = '<institution_id>'
  and exam_id = '<exam_id>'
  and pin_id = '<pin_id>'
order by started_at desc
limit 20;

-- ============================================================================
-- 2) Failed PIN validation rate-limit lookup
-- Route: POST /api/pins/validate
-- Query pattern:
--   where client_ip = ? and success = false and created_at >= ?
-- ============================================================================
explain (analyze, buffers, verbose)
select count(*) as failed_attempts_in_window
from public.pin_validation_attempts
where client_ip = '<candidate_client_ip>'::inet
  and success = false
  and created_at >= '<rate_limit_since_iso>'::timestamptz;

-- ============================================================================
-- 3) Integrity queue listing (tenant admin review page)
-- Route: /admin/integrity
-- Query pattern:
--   where institution_id = ? and submitted_at is not null
--   order by submitted_at desc limit 120
-- ============================================================================
explain (analyze, buffers, verbose)
select id, exam_id, candidate_id, status, submitted_at, created_at, integrity_score, integrity_events_count, attempt_metadata
from public.exam_attempts
where institution_id = '<institution_id>'
  and submitted_at is not null
order by submitted_at desc
limit 120;

-- ============================================================================
-- 4) Platform ops recent finalized attempts queue
-- Route: /admin/platform/operations (super admin)
-- Query pattern:
--   where status in ('submitted','auto_submitted')
--   order by updated_at desc limit 120
-- ============================================================================
explain (analyze, buffers, verbose)
select id, institution_id, status, updated_at
from public.exam_attempts
where status in ('submitted', 'auto_submitted')
order by updated_at desc
limit 120;

-- ============================================================================
-- NOTES
-- ============================================================================
-- Record:
-- - whether each query uses the expected new index
-- - actual timing (planning/execution)
-- - rows scanned vs returned
-- - any remaining sequential scans worth addressing
