-- Purge promoted vectors from the private resumable staging table. The compact
-- run receipt remains, while the single authoritative embedding copy stays in
-- ecos_hosted_chunk_embeddings.

begin;

create or replace function public.ecos_cleanup_committed_semantic_backfill_staging()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.state = 'staging' and new.state = 'committed' then
    delete from public.ecos_hosted_semantic_backfill_embeddings staged
    where staged.run_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists ecos_semantic_backfill_committed_staging_cleanup
  on public.ecos_hosted_semantic_backfill_runs;
create trigger ecos_semantic_backfill_committed_staging_cleanup
after update of state on public.ecos_hosted_semantic_backfill_runs
for each row
when (old.state is distinct from new.state and new.state = 'committed')
execute function public.ecos_cleanup_committed_semantic_backfill_staging();

delete from public.ecos_hosted_semantic_backfill_embeddings staged
using public.ecos_hosted_semantic_backfill_runs run
where staged.run_id = run.id
  and run.state = 'committed';

revoke all on function public.ecos_cleanup_committed_semantic_backfill_staging()
  from public, anon, authenticated;

commit;
