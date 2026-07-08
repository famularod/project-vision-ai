create table if not exists public.pie_decision_records (
  id text primary key,
  organization_id text not null,
  project_id text not null,
  current_status text not null check (
    current_status in (
      'proposed',
      'approved',
      'rejected',
      'deferred',
      'implemented',
      'awaiting_outcome',
      'outcome_observed',
      'outcome_validated',
      'closed',
      'cancelled'
    )
  ),
  current_version integer not null default 1,
  immutable_snapshot jsonb not null,
  outcome_plan jsonb,
  implementation_assessment jsonb,
  created_by jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  close_blockers jsonb not null default '[]'::jsonb
);

create table if not exists public.pie_decision_versions (
  id bigserial primary key,
  decision_id text not null references public.pie_decision_records(id) on delete restrict,
  organization_id text not null,
  project_id text not null,
  version integer not null,
  snapshot jsonb not null,
  created_by jsonb not null,
  created_at timestamptz not null default now(),
  reason text not null,
  unique (decision_id, version)
);

create table if not exists public.pie_decision_outcomes (
  id text primary key,
  decision_id text not null references public.pie_decision_records(id) on delete restrict,
  organization_id text not null,
  project_id text not null,
  classification text not null check (
    classification in (
      'successful',
      'partially_successful',
      'unsuccessful',
      'mixed',
      'inconclusive',
      'not_implemented',
      'cancelled'
    )
  ),
  summary text not null,
  actual_results jsonb not null default '[]'::jsonb,
  measured_values jsonb not null default '{}'::jsonb,
  prediction_comparisons jsonb not null default '[]'::jsonb,
  evidence_references jsonb not null default '[]'::jsonb,
  unintended_consequences jsonb not null default '[]'::jsonb,
  confounding_factors jsonb not null default '[]'::jsonb,
  observation_period jsonb not null,
  validation_status text not null check (
    validation_status in (
      'unvalidated',
      'system_supported',
      'human_validated',
      'disputed'
    )
  ),
  validator jsonb,
  validation_date timestamptz,
  created_by jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.pie_decision_audit_events (
  id text primary key,
  decision_id text not null references public.pie_decision_records(id) on delete restrict,
  organization_id text not null,
  project_id text not null,
  field text not null,
  previous_value text,
  new_value text,
  changed_by jsonb not null,
  reason text not null,
  source text not null check (source in ('user', 'system', 'sync', 'import', 'review')),
  linked_evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists pie_decision_records_org_project_idx
  on public.pie_decision_records (organization_id, project_id, current_status);

create index if not exists pie_decision_outcomes_decision_idx
  on public.pie_decision_outcomes (organization_id, project_id, decision_id);

create index if not exists pie_decision_audit_events_decision_idx
  on public.pie_decision_audit_events (organization_id, project_id, decision_id, created_at);

alter table public.pie_decision_records enable row level security;
alter table public.pie_decision_versions enable row level security;
alter table public.pie_decision_outcomes enable row level security;
alter table public.pie_decision_audit_events enable row level security;

-- Project Vision AI does not yet have a repository-visible organization table.
-- Policies must be bound to the final organization membership model before this
-- migration is applied in production.
