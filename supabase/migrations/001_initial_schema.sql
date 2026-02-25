-- Clavis Enterprise Schema v1
-- Foundation tables for multi-tenant assessment platform

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'institution_status') then
    create type public.institution_status as enum ('active', 'suspended', 'archived');
  end if;
  if not exists (select 1 from pg_type where typname = 'institution_admin_role') then
    create type public.institution_admin_role as enum ('owner', 'admin', 'editor', 'viewer');
  end if;
  if not exists (select 1 from pg_type where typname = 'exam_status') then
    create type public.exam_status as enum ('draft', 'published', 'archived');
  end if;
  if not exists (select 1 from pg_type where typname = 'question_type_v1') then
    create type public.question_type_v1 as enum ('mcq_single', 'mcq_multi', 'true_false', 'short_answer');
  end if;
  if not exists (select 1 from pg_type where typname = 'attempt_status') then
    create type public.attempt_status as enum ('in_progress', 'submitted', 'auto_submitted', 'expired', 'cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'pin_status') then
    create type public.pin_status as enum ('active', 'used', 'expired', 'revoked');
  end if;
  if not exists (select 1 from pg_type where typname = 'difficulty_level') then
    create type public.difficulty_level as enum ('easy', 'medium', 'hard');
  end if;
end$$;

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone text,
  platform_role text check (platform_role in ('super_admin') or platform_role is null),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.institutions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  status public.institution_status not null default 'active',
  logo_url text,
  timezone text not null default 'UTC',
  locale text not null default 'en-US',
  settings jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.institution_admins (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.institution_admin_role not null,
  is_active boolean not null default true,
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, user_id)
);

create table if not exists public.admin_invitations (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  email text not null,
  role public.institution_admin_role not null,
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked')),
  expires_at timestamptz not null,
  invited_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  code text,
  name text not null,
  settings jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, name)
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  question_type public.question_type_v1 not null,
  prompt text not null,
  explanation text,
  options jsonb,
  correct_answer jsonb not null,
  short_answer_rules jsonb,
  difficulty public.difficulty_level not null default 'medium',
  tags text[] not null default '{}',
  source text,
  content_hash text not null,
  usage_count integer not null default 0,
  stats jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, content_hash)
);

create index if not exists idx_questions_institution_subject on public.questions (institution_id, subject_id);
create index if not exists idx_questions_institution_type on public.questions (institution_id, question_type);
create index if not exists idx_questions_institution_deleted_at on public.questions (institution_id, deleted_at);

create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  title text not null,
  description text,
  status public.exam_status not null default 'draft',
  duration_minutes integer not null check (duration_minutes > 0),
  passing_score numeric(5,2),
  shuffle_questions boolean not null default true,
  shuffle_options boolean not null default false,
  show_result_immediately boolean not null default true,
  allow_review boolean not null default true,
  max_attempts integer not null default 1 check (max_attempts > 0),
  settings jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  archived_at timestamptz,
  deleted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exam_sections (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  title text not null,
  question_count integer not null check (question_count > 0),
  difficulty_distribution jsonb not null default '{}'::jsonb,
  selection_mode text not null default 'random' check (selection_mode in ('random', 'manual')),
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exam_questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  section_id uuid references public.exam_sections(id) on delete set null,
  question_id uuid not null references public.questions(id) on delete restrict,
  display_order integer not null default 0,
  points numeric(8,2) not null default 1,
  required boolean not null default true,
  created_at timestamptz not null default now(),
  unique (exam_id, question_id)
);

create index if not exists idx_exam_questions_exam_order on public.exam_questions (exam_id, display_order);

create table if not exists public.pin_batches (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  exam_id uuid not null references public.exams(id) on delete cascade,
  batch_name text not null,
  prefix text,
  quantity integer not null check (quantity > 0),
  expires_at timestamptz,
  usage_limit_per_pin integer not null default 1 check (usage_limit_per_pin > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exam_pins (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  exam_id uuid not null references public.exams(id) on delete cascade,
  batch_id uuid references public.pin_batches(id) on delete set null,
  pin_hash text not null unique,
  pin_hint text,
  status public.pin_status not null default 'active',
  max_uses integer not null default 1 check (max_uses > 0),
  uses_count integer not null default 0,
  allow_list_enabled boolean not null default false,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pin_allow_list (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  exam_pin_id uuid not null references public.exam_pins(id) on delete cascade,
  candidate_identifier text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (exam_pin_id, candidate_identifier)
);

create table if not exists public.pin_validation_attempts (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions(id) on delete set null,
  pin_id uuid references public.exam_pins(id) on delete set null,
  entered_pin_hash text,
  client_ip inet,
  user_agent text,
  candidate_identifier text,
  success boolean not null default false,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_pin_validation_attempts_ip_created on public.pin_validation_attempts (client_ip, created_at desc);

create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  email text,
  full_name text not null,
  phone text,
  registration_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exam_attempts (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  exam_id uuid not null references public.exams(id) on delete restrict,
  candidate_id uuid not null references public.candidates(id) on delete restrict,
  pin_id uuid references public.exam_pins(id) on delete set null,
  status public.attempt_status not null default 'in_progress',
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  expires_at timestamptz,
  last_saved_at timestamptz,
  current_question_index integer not null default 0,
  shuffled_question_order jsonb,
  integrity_events_count integer not null default 0,
  integrity_score numeric(5,2),
  client_metadata jsonb not null default '{}'::jsonb,
  attempt_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_exam_attempts_institution_exam on public.exam_attempts (institution_id, exam_id);
create index if not exists idx_exam_attempts_candidate on public.exam_attempts (candidate_id, created_at desc);
create index if not exists idx_exam_attempts_status on public.exam_attempts (institution_id, status);

create table if not exists public.attempt_answers (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  attempt_id uuid not null references public.exam_attempts(id) on delete cascade,
  exam_id uuid not null references public.exams(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete restrict,
  answer_payload jsonb not null default '{}'::jsonb,
  is_final boolean not null default false,
  saved_at timestamptz not null default now(),
  version_no integer not null default 1,
  unique (attempt_id, question_id)
);

create index if not exists idx_attempt_answers_attempt on public.attempt_answers (attempt_id);

create table if not exists public.attempt_answer_history (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  attempt_id uuid not null references public.exam_attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete restrict,
  answer_payload jsonb not null default '{}'::jsonb,
  version_no integer not null,
  changed_at timestamptz not null default now()
);

create table if not exists public.exam_results (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  attempt_id uuid not null unique references public.exam_attempts(id) on delete cascade,
  exam_id uuid not null references public.exams(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  total_questions integer not null,
  answered_questions integer not null,
  correct_count integer not null,
  incorrect_count integer not null,
  score numeric(8,2) not null,
  percentage numeric(5,2) not null,
  grade_letter text,
  integrity_score numeric(5,2),
  subject_breakdown jsonb not null default '{}'::jsonb,
  analytics_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_exam_results_exam on public.exam_results (institution_id, exam_id, created_at desc);

create table if not exists public.exam_analytics_daily (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  exam_id uuid not null references public.exams(id) on delete cascade,
  date_key date not null,
  attempts_count integer not null default 0,
  submissions_count integer not null default 0,
  avg_percentage numeric(5,2),
  pass_rate numeric(5,2),
  aggregates jsonb not null default '{}'::jsonb,
  unique (institution_id, exam_id, date_key)
);

create table if not exists public.question_analytics (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  question_id uuid not null unique references public.questions(id) on delete cascade,
  exposure_count integer not null default 0,
  answer_count integer not null default 0,
  correct_count integer not null default 0,
  option_popularity jsonb not null default '{}'::jsonb,
  discrimination_index numeric(8,4),
  difficulty_index numeric(8,4),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_institution_created on public.audit_logs (institution_id, created_at desc);
create index if not exists idx_audit_logs_action_created on public.audit_logs (action, created_at desc);

create table if not exists public.usage_counters (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  metric_key text not null,
  metric_period text not null default 'all_time',
  metric_value bigint not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (institution_id, metric_key, metric_period)
);

create table if not exists public.plan_limits (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  limits jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.institution_plans (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null unique references public.institutions(id) on delete cascade,
  plan_id uuid not null references public.plan_limits(id) on delete restrict,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.file_assets (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  bucket text not null,
  object_path text not null,
  asset_type text not null,
  mime_type text,
  size_bytes bigint,
  metadata jsonb not null default '{}'::jsonb,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (bucket, object_path)
);
