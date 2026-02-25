-- Clavis Phase 1.5 RLS validation scaffold
-- Run manually in Supabase SQL Editor or psql against a non-production environment.
-- Fill in the placeholders below before executing.

-- ============================================================================
-- VARIABLES / PLACEHOLDERS (replace values)
-- ============================================================================
-- :institution_a_id
-- :institution_b_id
-- :user_a_id
-- :user_b_id
-- :super_admin_user_id
-- :exam_a_id
-- :exam_b_id
-- :pin_a_id
-- :pin_b_id

-- ============================================================================
-- NOTE ABOUT AUTH CONTEXT
-- ============================================================================
-- RLS policies depend on auth.uid(). To test accurately, run queries through:
-- 1) Supabase client sessions for each user, or
-- 2) Postgres sessions where JWT claims are set to simulate auth.uid().
--
-- Example (adapt to your environment/tooling):
-- select set_config('request.jwt.claim.sub', '<user_uuid>', true);

-- ============================================================================
-- 1.5.1 RLS TESTING SUITE
-- ============================================================================

-- 1) Admin from Institution A cannot read Institution B data
-- Expected: 0 rows when authenticated as user_a for institution_b resources.
select id, name, slug
from public.institutions
where id = '<institution_b_id>';

select id, title, status
from public.exams
where institution_id = '<institution_b_id>'
limit 10;

select id, email, role, status
from public.admin_invitations
where institution_id = '<institution_b_id>'
limit 10;

-- 2) Super admin override works correctly
-- Expected: super admin can read across institutions where policies allow super admin.
select id, name, slug from public.institutions where id in ('<institution_a_id>', '<institution_b_id>');
select id, user_id, role, is_active from public.institution_admins where institution_id in ('<institution_a_id>', '<institution_b_id>');

-- 3) Direct table queries from client are blocked (manual app/browser verification)
-- Expected: no service-role-only secrets; restricted writes fail from client.
-- Document results in PHASE_1_5_RLS_VALIDATION.md.

-- 4) Attempt/answer/result isolation
select id, exam_id, candidate_id, status
from public.exam_attempts
where institution_id = '<institution_b_id>'
limit 10;

select id, attempt_id, question_id
from public.attempt_answers
where institution_id = '<institution_b_id>'
limit 10;

select id, exam_id, candidate_id, percentage_score
from public.exam_results
where institution_id = '<institution_b_id>'
limit 10;

-- 5) Audit log tenant scoping
select id, action, created_at
from public.audit_logs
where institution_id = '<institution_b_id>'
order by created_at desc
limit 20;

-- ============================================================================
-- 1.5.2 SECURITY VALIDATION (SQL-side checks only; complete with app/API tests)
-- ============================================================================

-- Cross-tenant exam access attempt
select id, title, status
from public.exams
where id = '<exam_b_id>';

-- Cross-tenant PIN access attempt
select id, status, uses_count
from public.exam_pins
where id = '<pin_b_id>';

-- Correct answer exposure test (verify role/client path restrictions)
-- NOTE: Questions table stores correct_answer. Ensure client/API paths do not expose it.
select id, prompt, correct_answer
from public.questions
where institution_id = '<institution_b_id>'
limit 5;

-- Service role exposure validation cannot be fully tested in SQL editor.
-- Confirm on app side:
-- - service role key absent from client bundle
-- - only NEXT_PUBLIC_* vars are exposed
