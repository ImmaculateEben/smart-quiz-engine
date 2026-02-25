-- Phase 10.2 performance indexes (query-pattern driven)
-- Targets:
-- - candidate attempt resume lookup by institution/exam/pin ordered by started_at
-- - failed PIN validation rate-limit checks by client IP
-- - admin integrity queue ordered by submitted_at
-- - platform operations recent submitted attempts ordered by updated_at

create index if not exists idx_exam_attempts_resume_lookup
  on public.exam_attempts (institution_id, exam_id, pin_id, started_at desc);

create index if not exists idx_exam_attempts_status_updated
  on public.exam_attempts (status, updated_at desc);

create index if not exists idx_exam_attempts_institution_submitted_at
  on public.exam_attempts (institution_id, submitted_at desc)
  where submitted_at is not null;

create index if not exists idx_pin_validation_attempts_failed_ip_created
  on public.pin_validation_attempts (client_ip, created_at desc)
  where success = false;
