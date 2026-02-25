-- Platform operational tooling (Phase 9.3)

create table if not exists public.platform_operation_jobs (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions(id) on delete set null,
  job_type text not null check (
    job_type in (
      'scoring_reprocess_attempt',
      'question_import_reprocess_review',
      'error_monitoring_test',
      'support_followup'
    )
  ),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  priority smallint not null default 5 check (priority between 1 and 9),
  requested_by uuid references auth.users(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  source text,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error_message text,
  attempts_count integer not null default 0,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_platform_operation_jobs_status_created
  on public.platform_operation_jobs (status, created_at desc);
create index if not exists idx_platform_operation_jobs_type_created
  on public.platform_operation_jobs (job_type, created_at desc);
create index if not exists idx_platform_operation_jobs_institution
  on public.platform_operation_jobs (institution_id, created_at desc);

create table if not exists public.platform_support_cases (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions(id) on delete set null,
  related_job_id uuid references public.platform_operation_jobs(id) on delete set null,
  title text not null,
  description text,
  category text not null default 'general' check (
    category in ('general', 'import_failure', 'scoring_failure', 'tenant_access', 'billing_like_limit', 'integrity_review')
  ),
  status text not null default 'open' check (
    status in ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed')
  ),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  assignee_user_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  resolution_notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists idx_platform_support_cases_status_created
  on public.platform_support_cases (status, created_at desc);
create index if not exists idx_platform_support_cases_institution
  on public.platform_support_cases (institution_id, created_at desc);
create index if not exists idx_platform_support_cases_related_job
  on public.platform_support_cases (related_job_id);

alter table public.platform_operation_jobs enable row level security;
alter table public.platform_support_cases enable row level security;

drop policy if exists "platform_operation_jobs super admin read" on public.platform_operation_jobs;
create policy "platform_operation_jobs super admin read"
  on public.platform_operation_jobs
  for select
  using (
    exists (
      select 1
      from public.user_profiles up
      where up.user_id = auth.uid()
        and up.platform_role = 'super_admin'
    )
  );

drop policy if exists "platform_operation_jobs super admin write" on public.platform_operation_jobs;
create policy "platform_operation_jobs super admin write"
  on public.platform_operation_jobs
  for all
  using (
    exists (
      select 1
      from public.user_profiles up
      where up.user_id = auth.uid()
        and up.platform_role = 'super_admin'
    )
  )
  with check (
    exists (
      select 1
      from public.user_profiles up
      where up.user_id = auth.uid()
        and up.platform_role = 'super_admin'
    )
  );

drop policy if exists "platform_support_cases super admin read" on public.platform_support_cases;
create policy "platform_support_cases super admin read"
  on public.platform_support_cases
  for select
  using (
    exists (
      select 1
      from public.user_profiles up
      where up.user_id = auth.uid()
        and up.platform_role = 'super_admin'
    )
  );

drop policy if exists "platform_support_cases super admin write" on public.platform_support_cases;
create policy "platform_support_cases super admin write"
  on public.platform_support_cases
  for all
  using (
    exists (
      select 1
      from public.user_profiles up
      where up.user_id = auth.uid()
        and up.platform_role = 'super_admin'
    )
  )
  with check (
    exists (
      select 1
      from public.user_profiles up
      where up.user_id = auth.uid()
        and up.platform_role = 'super_admin'
    )
  );
