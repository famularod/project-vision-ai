create table if not exists public.pie_executive_judgments (
  id text primary key,
  organization_id text not null,
  project_id text not null,
  reality_model_id text not null,
  reality_model_version integer not null,
  reality_snapshot_id text not null,
  judgment_time timestamptz not null,
  situation_summary text not null,
  primary_recommendation text not null,
  alternatives_considered jsonb not null default '[]'::jsonb,
  tradeoffs jsonb not null default '{}'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  constraints jsonb not null default '[]'::jsonb,
  opportunities jsonb not null default '[]'::jsonb,
  resource_considerations jsonb not null default '[]'::jsonb,
  priority_rationale text not null,
  escalation_rationale text not null,
  authority_requirement text not null,
  no_action_option text not null,
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  uncertainty jsonb not null default '[]'::jsonb,
  supporting_reality_object_ids jsonb not null default '[]'::jsonb,
  supporting_assertion_ids jsonb not null default '[]'::jsonb,
  active_conflict_ids jsonb not null default '[]'::jsonb,
  active_uncertainty_ids jsonb not null default '[]'::jsonb,
  evidence_cutoff_time timestamptz not null,
  conditions_that_would_change_recommendation jsonb not null default '[]'::jsonb,
  superseded_by text null,
  superseded_at timestamptz null,
  immutable boolean not null default true,
  created_at timestamptz not null default now(),
  check (immutable = true),
  check (reality_model_version > 0),
  check (jsonb_array_length(supporting_reality_object_ids) >= 0),
  check (jsonb_array_length(supporting_assertion_ids) >= 0)
);

create index if not exists pie_executive_judgments_org_project_idx
  on public.pie_executive_judgments (organization_id, project_id, judgment_time desc);

create index if not exists pie_executive_judgments_reality_idx
  on public.pie_executive_judgments (organization_id, project_id, reality_model_id, reality_model_version);

create or replace function public.pie_executive_judgment_prevent_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Executive Judgment records are immutable. Create a new judgment record instead.';
end;
$$;

drop trigger if exists pie_executive_judgment_no_update on public.pie_executive_judgments;
create trigger pie_executive_judgment_no_update
  before update on public.pie_executive_judgments
  for each row execute function public.pie_executive_judgment_prevent_mutation();

drop trigger if exists pie_executive_judgment_no_delete on public.pie_executive_judgments;
create trigger pie_executive_judgment_no_delete
  before delete on public.pie_executive_judgments
  for each row execute function public.pie_executive_judgment_prevent_mutation();

alter table public.pie_executive_judgments enable row level security;

drop policy if exists "pie_executive_judgments_select" on public.pie_executive_judgments;
create policy "pie_executive_judgments_select"
  on public.pie_executive_judgments
  for select
  using (public.pie_layer4_has_permission(organization_id, project_id, 'view_decision_history'));

drop policy if exists "pie_executive_judgments_insert" on public.pie_executive_judgments;
create policy "pie_executive_judgments_insert"
  on public.pie_executive_judgments
  for insert
  with check (public.pie_layer4_has_permission(organization_id, project_id, 'create_decision_candidate'));
