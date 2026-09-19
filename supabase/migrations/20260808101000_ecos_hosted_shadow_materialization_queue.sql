-- ECOS hosted shadow materialization queue
--
-- Page checkpoints are the durable evidence boundary. Shadow search chunk
-- materialization can expand large JSON pages and must not run inside the same
-- transaction: a search-index timeout must never roll back an assured page.
-- The trigger below therefore records a small, durable shadow-only queue item.
-- The hosted worker drains one page per service-only RPC transaction, and the
-- ready-state guard keeps shadow retrieval fail-closed until the queue is empty.

begin;

create table if not exists public.ecos_hosted_shadow_materialization_queue (
  job_id uuid not null references public.ecos_hosted_index_jobs(id) on delete cascade,
  page_number integer not null check (page_number between 1 and 10000),
  operation text not null check (operation in ('refresh', 'delete')),
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (job_id, page_number)
);

create index if not exists ecos_hosted_shadow_materialization_queue_requested_idx
  on public.ecos_hosted_shadow_materialization_queue (job_id, requested_at, page_number);

alter table public.ecos_hosted_shadow_materialization_queue enable row level security;
alter table public.ecos_hosted_shadow_materialization_queue force row level security;
revoke all on table public.ecos_hosted_shadow_materialization_queue
  from public, anon, authenticated;
grant all on table public.ecos_hosted_shadow_materialization_queue to service_role;

-- This replaces the earlier synchronous trigger body without changing the
-- existing trigger definitions. It intentionally does not read or expand page
-- JSON and never calls a chunk refresh function.
create or replace function public.ecos_sync_hosted_shadow_page_chunks()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  selected_job_id uuid;
  selected_page_number integer;
  selected_mode text;
  selected_operation text;
begin
  if tg_op = 'DELETE' then
    selected_job_id := old.job_id;
    selected_page_number := old.page_number;
  else
    selected_job_id := new.job_id;
    selected_page_number := new.page_number;
  end if;

  select job.mode into selected_mode
  from public.ecos_hosted_index_jobs job
  where job.id = selected_job_id;

  -- Live publication and customer-search tables are deliberately unaffected.
  if selected_mode is distinct from 'shadow' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op <> 'DELETE'
      and new.state = 'assured'
      and new.assurance_result->>'accepted' = 'true'
      and new.unresolved_region_count = 0 then
    selected_operation := 'refresh';
  else
    selected_operation := 'delete';
  end if;

  insert into public.ecos_hosted_shadow_materialization_queue (
    job_id, page_number, operation, requested_at, updated_at
  ) values (
    selected_job_id, selected_page_number, selected_operation, now(), now()
  )
  on conflict (job_id, page_number) do update set
    operation = excluded.operation,
    requested_at = excluded.requested_at,
    updated_at = excluded.updated_at;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Materialize at most one queued page in this transaction. If chunk generation
-- fails or times out, PostgreSQL rolls this transaction back and the queue item
-- remains available for the next worker attempt. The assured page checkpoint is
-- already committed in a different transaction and remains exact and durable.
create or replace function public.ecos_materialize_next_hosted_shadow_page(
  p_job_id uuid,
  p_claim_token uuid
)
returns table(
  page_number integer,
  operation text,
  chunk_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '150s'
set lock_timeout = '5s'
as $$
declare
  selected_job public.ecos_hosted_index_jobs%rowtype;
  pending public.ecos_hosted_shadow_materialization_queue%rowtype;
  materialized_count integer := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'Worker authorization required'; end if;

  select job.* into selected_job
  from public.ecos_hosted_index_jobs job
  where job.id = p_job_id
    and job.claim_token = p_claim_token
    and job.mode = 'shadow';
  if not found then raise exception 'Shadow worker lease is unavailable'; end if;

  select queued.* into pending
  from public.ecos_hosted_shadow_materialization_queue queued
  where queued.job_id = selected_job.id
  order by queued.requested_at, queued.page_number
  for update skip locked
  limit 1;
  if not found then return; end if;

  if pending.operation = 'delete' then
    delete from public.ecos_hosted_shadow_chunks chunk
    where chunk.job_id = pending.job_id
      and chunk.page_number = pending.page_number;
    get diagnostics materialized_count = row_count;
  else
    materialized_count := public.ecos_refresh_hosted_shadow_page(
      pending.job_id,
      pending.page_number
    );
    materialized_count := materialized_count
      + public.ecos_append_hosted_shadow_region_text(
          pending.job_id,
          pending.page_number
        );
  end if;

  delete from public.ecos_hosted_shadow_materialization_queue queued
  where queued.job_id = pending.job_id
    and queued.page_number = pending.page_number;

  return query select pending.page_number, pending.operation, materialized_count;
end;
$$;

-- A shadow job is not queryable until every assured checkpoint has completed
-- its separate search-index transaction. This guard does not run for live jobs
-- and does not modify the live publication function or tables.
create or replace function public.ecos_require_complete_shadow_materialization()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.mode = 'shadow'
    and new.state = 'ready'
    and exists (
      select 1
      from public.ecos_hosted_shadow_materialization_queue queued
      where queued.job_id = new.id
    ) then
    raise exception using
      errcode = '55000',
      message = 'Shadow search materialization is incomplete';
  end if;
  return new;
end;
$$;

drop trigger if exists ecos_hosted_shadow_ready_materialization_guard
  on public.ecos_hosted_index_jobs;
create trigger ecos_hosted_shadow_ready_materialization_guard
before insert or update of state on public.ecos_hosted_index_jobs
for each row execute function public.ecos_require_complete_shadow_materialization();

revoke all on function public.ecos_sync_hosted_shadow_page_chunks()
  from public, anon, authenticated, service_role;
revoke all on function public.ecos_materialize_next_hosted_shadow_page(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.ecos_require_complete_shadow_materialization()
  from public, anon, authenticated, service_role;
grant execute on function public.ecos_materialize_next_hosted_shadow_page(uuid, uuid)
  to service_role;

commit;
