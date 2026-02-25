-- Phase 10.1 security hardening:
-- Revoke direct anon access to application objects in the public schema.
-- Candidate/public flows should use server/API routes (service role) instead of anon table access.

begin;

-- Existing objects
revoke all privileges on all tables in schema public from anon;
revoke all privileges on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;

-- Future objects created by subsequent migrations
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;

commit;
