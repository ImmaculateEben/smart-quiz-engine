-- Clavis helper functions, triggers and RLS baseline

create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.current_user_id()
returns uuid
language sql
stable
as $$ select auth.uid(); $$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles up
    where up.user_id = auth.uid()
      and up.platform_role = 'super_admin'
  );
$$;

create or replace function public.user_has_institution_access(target_institution_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
  or exists (
    select 1
    from public.institution_admins ia
    where ia.institution_id = target_institution_id
      and ia.user_id = auth.uid()
      and ia.is_active = true
  );
$$;

create or replace function public.user_has_institution_role(
  target_institution_id uuid,
  allowed_roles public.institution_admin_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
  or exists (
    select 1
    from public.institution_admins ia
    where ia.institution_id = target_institution_id
      and ia.user_id = auth.uid()
      and ia.is_active = true
      and ia.role = any(allowed_roles)
  );
$$;

create or replace function public.audit_log(
  p_institution_id uuid,
  p_action text,
  p_entity_type text default null,
  p_entity_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.audit_logs (institution_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_institution_id, auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.increment_usage_counter(
  p_institution_id uuid,
  p_metric_key text,
  p_metric_period text default 'all_time',
  p_increment_by bigint default 1
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.usage_counters (institution_id, metric_key, metric_period, metric_value)
  values (p_institution_id, p_metric_key, p_metric_period, p_increment_by)
  on conflict (institution_id, metric_key, metric_period)
  do update
    set metric_value = public.usage_counters.metric_value + excluded.metric_value,
        updated_at = now();
end;
$$;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'user_profiles','institutions','institution_admins','admin_invitations','subjects','questions',
    'exams','exam_sections','pin_batches','exam_pins','candidates','exam_attempts',
    'question_analytics','usage_counters','plan_limits','institution_plans'
  ]
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = tbl and column_name = 'updated_at'
    ) then
      execute format('drop trigger if exists trg_%I_updated_at on public.%I', tbl, tbl);
      execute format(
        'create trigger trg_%I_updated_at before update on public.%I for each row execute function public.tg_set_updated_at()',
        tbl, tbl
      );
    end if;
  end loop;
end$$;

alter table public.user_profiles enable row level security;
alter table public.institutions enable row level security;
alter table public.institution_admins enable row level security;
alter table public.admin_invitations enable row level security;
alter table public.subjects enable row level security;
alter table public.questions enable row level security;
alter table public.exams enable row level security;
alter table public.exam_sections enable row level security;
alter table public.exam_questions enable row level security;
alter table public.pin_batches enable row level security;
alter table public.exam_pins enable row level security;
alter table public.pin_allow_list enable row level security;
alter table public.pin_validation_attempts enable row level security;
alter table public.candidates enable row level security;
alter table public.exam_attempts enable row level security;
alter table public.attempt_answers enable row level security;
alter table public.attempt_answer_history enable row level security;
alter table public.exam_results enable row level security;
alter table public.exam_analytics_daily enable row level security;
alter table public.question_analytics enable row level security;
alter table public.audit_logs enable row level security;
alter table public.usage_counters enable row level security;
alter table public.plan_limits enable row level security;
alter table public.institution_plans enable row level security;
alter table public.file_assets enable row level security;

-- Self profile
create policy "user_profiles_self_select"
on public.user_profiles for select
using (user_id = auth.uid() or public.is_super_admin());

create policy "user_profiles_self_update"
on public.user_profiles for update
using (user_id = auth.uid() or public.is_super_admin())
with check (user_id = auth.uid() or public.is_super_admin());

-- Institution and admin records
create policy "institutions_read_member"
on public.institutions for select
using (public.user_has_institution_access(id));

create policy "institutions_write_owner_admin"
on public.institutions for update
using (public.user_has_institution_role(id, array['owner','admin']::public.institution_admin_role[]))
with check (public.user_has_institution_role(id, array['owner','admin']::public.institution_admin_role[]));

create policy "institution_admins_read_member"
on public.institution_admins for select
using (public.user_has_institution_access(institution_id));

create policy "institution_admins_manage_owner_admin"
on public.institution_admins for all
using (public.user_has_institution_role(institution_id, array['owner','admin']::public.institution_admin_role[]))
with check (public.user_has_institution_role(institution_id, array['owner','admin']::public.institution_admin_role[]));

create policy "admin_invitations_read_member"
on public.admin_invitations for select
using (public.user_has_institution_access(institution_id));

create policy "admin_invitations_manage_owner_admin"
on public.admin_invitations for all
using (public.user_has_institution_role(institution_id, array['owner','admin']::public.institution_admin_role[]))
with check (public.user_has_institution_role(institution_id, array['owner','admin']::public.institution_admin_role[]));

-- Content and exam builder tables
create policy "subjects_read_member" on public.subjects for select
using (public.user_has_institution_access(institution_id));
create policy "subjects_write_editor_plus" on public.subjects for all
using (public.user_has_institution_role(institution_id, array['owner','admin','editor']::public.institution_admin_role[]))
with check (public.user_has_institution_role(institution_id, array['owner','admin','editor']::public.institution_admin_role[]));

create policy "questions_read_member" on public.questions for select
using (public.user_has_institution_access(institution_id));
create policy "questions_write_editor_plus" on public.questions for all
using (public.user_has_institution_role(institution_id, array['owner','admin','editor']::public.institution_admin_role[]))
with check (public.user_has_institution_role(institution_id, array['owner','admin','editor']::public.institution_admin_role[]));

create policy "exams_read_member" on public.exams for select
using (public.user_has_institution_access(institution_id));
create policy "exams_write_editor_plus" on public.exams for all
using (public.user_has_institution_role(institution_id, array['owner','admin','editor']::public.institution_admin_role[]))
with check (public.user_has_institution_role(institution_id, array['owner','admin','editor']::public.institution_admin_role[]));

create policy "exam_sections_read_member" on public.exam_sections for select
using (public.user_has_institution_access(institution_id));
create policy "exam_sections_write_editor_plus" on public.exam_sections for all
using (public.user_has_institution_role(institution_id, array['owner','admin','editor']::public.institution_admin_role[]))
with check (public.user_has_institution_role(institution_id, array['owner','admin','editor']::public.institution_admin_role[]));

create policy "exam_questions_read_member" on public.exam_questions for select
using (public.user_has_institution_access(institution_id));
create policy "exam_questions_write_editor_plus" on public.exam_questions for all
using (public.user_has_institution_role(institution_id, array['owner','admin','editor']::public.institution_admin_role[]))
with check (public.user_has_institution_role(institution_id, array['owner','admin','editor']::public.institution_admin_role[]));

-- PIN tables
create policy "pin_batches_read_member" on public.pin_batches for select
using (public.user_has_institution_access(institution_id));
create policy "pin_batches_write_admin_plus" on public.pin_batches for all
using (public.user_has_institution_role(institution_id, array['owner','admin']::public.institution_admin_role[]))
with check (public.user_has_institution_role(institution_id, array['owner','admin']::public.institution_admin_role[]));

create policy "exam_pins_read_member" on public.exam_pins for select
using (public.user_has_institution_access(institution_id));
create policy "exam_pins_write_admin_plus" on public.exam_pins for all
using (public.user_has_institution_role(institution_id, array['owner','admin']::public.institution_admin_role[]))
with check (public.user_has_institution_role(institution_id, array['owner','admin']::public.institution_admin_role[]));

create policy "pin_allow_list_read_member" on public.pin_allow_list for select
using (public.user_has_institution_access(institution_id));
create policy "pin_allow_list_write_admin_plus" on public.pin_allow_list for all
using (public.user_has_institution_role(institution_id, array['owner','admin']::public.institution_admin_role[]))
with check (public.user_has_institution_role(institution_id, array['owner','admin']::public.institution_admin_role[]));

create policy "pin_validation_attempts_read_admin_plus" on public.pin_validation_attempts for select
using (institution_id is not null and public.user_has_institution_role(institution_id, array['owner','admin']::public.institution_admin_role[]));

-- Candidate/attempt/results read-only to tenant admins by default (writes via service role/server functions)
create policy "candidates_read_member" on public.candidates for select
using (public.user_has_institution_access(institution_id));
create policy "exam_attempts_read_member" on public.exam_attempts for select
using (public.user_has_institution_access(institution_id));
create policy "attempt_answers_read_member" on public.attempt_answers for select
using (public.user_has_institution_access(institution_id));
create policy "attempt_answer_history_read_member" on public.attempt_answer_history for select
using (public.user_has_institution_access(institution_id));
create policy "exam_results_read_member" on public.exam_results for select
using (public.user_has_institution_access(institution_id));
create policy "exam_analytics_daily_read_member" on public.exam_analytics_daily for select
using (public.user_has_institution_access(institution_id));
create policy "question_analytics_read_member" on public.question_analytics for select
using (public.user_has_institution_access(institution_id));

-- Audit / usage / plans / files
create policy "audit_logs_read_admin_plus" on public.audit_logs for select
using (
  (institution_id is null and public.is_super_admin())
  or (institution_id is not null and public.user_has_institution_role(institution_id, array['owner','admin']::public.institution_admin_role[]))
);

create policy "usage_counters_read_member" on public.usage_counters for select
using (public.user_has_institution_access(institution_id));
create policy "usage_counters_write_admin_plus" on public.usage_counters for all
using (public.user_has_institution_role(institution_id, array['owner','admin']::public.institution_admin_role[]))
with check (public.user_has_institution_role(institution_id, array['owner','admin']::public.institution_admin_role[]));

create policy "institution_plans_read_member" on public.institution_plans for select
using (public.user_has_institution_access(institution_id));
create policy "institution_plans_manage_super_admin" on public.institution_plans for all
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "plan_limits_read_all" on public.plan_limits for select using (true);
create policy "plan_limits_manage_super_admin" on public.plan_limits for all
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "file_assets_read_member" on public.file_assets for select
using (public.user_has_institution_access(institution_id));
create policy "file_assets_write_editor_plus" on public.file_assets for all
using (public.user_has_institution_role(institution_id, array['owner','admin','editor']::public.institution_admin_role[]))
with check (public.user_has_institution_role(institution_id, array['owner','admin','editor']::public.institution_admin_role[]));

-- Force RLS on sensitive operational tables
alter table public.exam_attempts force row level security;
alter table public.attempt_answers force row level security;
alter table public.attempt_answer_history force row level security;
alter table public.exam_results force row level security;
alter table public.pin_validation_attempts force row level security;
