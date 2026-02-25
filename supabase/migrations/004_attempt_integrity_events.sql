-- Candidate integrity event logging (Phase 7.3)

create table if not exists public.attempt_integrity_events (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  exam_id uuid not null references public.exams(id) on delete cascade,
  attempt_id uuid not null references public.exam_attempts(id) on delete cascade,
  candidate_id uuid references public.candidates(id) on delete set null,
  event_type text not null,
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  occurred_at_client timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_attempt_integrity_events_attempt_created
  on public.attempt_integrity_events (attempt_id, created_at desc);
create index if not exists idx_attempt_integrity_events_institution_created
  on public.attempt_integrity_events (institution_id, created_at desc);

alter table public.attempt_integrity_events enable row level security;

create policy "attempt_integrity_events_read_admin_plus"
on public.attempt_integrity_events for select
using (
  public.user_has_institution_role(institution_id, array['owner','admin']::public.institution_admin_role[])
);

alter table public.attempt_integrity_events force row level security;
