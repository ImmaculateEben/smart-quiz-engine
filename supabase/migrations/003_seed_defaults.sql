-- Clavis default usage limit profiles (no billing integration)

insert into public.plan_limits (code, name, limits)
values
  ('starter', 'Starter', '{
    "max_subjects": 25,
    "max_questions": 5000,
    "max_exams": 100,
    "max_pins_per_month": 10000,
    "max_admins": 5,
    "max_storage_mb": 512
  }'::jsonb),
  ('growth', 'Growth', '{
    "max_subjects": 100,
    "max_questions": 50000,
    "max_exams": 1000,
    "max_pins_per_month": 100000,
    "max_admins": 25,
    "max_storage_mb": 4096
  }'::jsonb),
  ('enterprise', 'Enterprise', '{
    "max_subjects": 1000,
    "max_questions": 1000000,
    "max_exams": 10000,
    "max_pins_per_month": 10000000,
    "max_admins": 500,
    "max_storage_mb": 102400
  }'::jsonb)
on conflict (code) do update
set
  name = excluded.name,
  limits = excluded.limits,
  updated_at = now();

-- Bootstrap notes:
-- 1. Create a user in Supabase Auth.
-- 2. Insert that user into public.user_profiles with platform_role='super_admin'.
-- 3. Create an institution row.
-- 4. Attach institution owner in public.institution_admins.
-- 5. Assign a plan in public.institution_plans.
