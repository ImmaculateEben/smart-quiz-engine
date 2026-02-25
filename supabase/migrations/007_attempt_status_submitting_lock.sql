-- Prevent duplicate/replay submission processing by reserving an in-flight submit state.
-- The candidate submit API atomically transitions `in_progress` -> `submitting`
-- before scoring and analytics writes, then finalizes to `submitted` / `auto_submitted`.

alter type public.attempt_status add value if not exists 'submitting';
