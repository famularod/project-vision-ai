-- A completed shadow preparation is private candidate evidence. It must never
-- hydrate the customer-facing reference document before a controlled live
-- publication. Keep the existing verified-commit function for live jobs, but
-- make both of its trigger entry points explicitly live-only.

begin;

drop trigger if exists ecos_mark_hosted_verified_index_commit_insert_trigger
  on public.ecos_hosted_index_jobs;
create trigger ecos_mark_hosted_verified_index_commit_insert_trigger
after insert
on public.ecos_hosted_index_jobs
for each row
when (
  new.mode = 'live'
  and new.state = 'ready'
  and new.committed_evidence_version = 'ecos-hosted-evidence/1.3'
)
execute function public.ecos_mark_hosted_verified_index_commit();

drop trigger if exists ecos_mark_hosted_verified_index_commit_update_trigger
  on public.ecos_hosted_index_jobs;
create trigger ecos_mark_hosted_verified_index_commit_update_trigger
after update of
  state,
  committed_evidence_version,
  completed_page_count,
  assured_page_count,
  unresolved_region_count
on public.ecos_hosted_index_jobs
for each row
when (
  new.mode = 'live'
  and new.state = 'ready'
  and new.committed_evidence_version = 'ecos-hosted-evidence/1.3'
  and (
    old.state is distinct from new.state
    or old.committed_evidence_version is distinct from new.committed_evidence_version
    or old.completed_page_count is distinct from new.completed_page_count
    or old.assured_page_count is distinct from new.assured_page_count
    or old.unresolved_region_count is distinct from new.unresolved_region_count
  )
)
execute function public.ecos_mark_hosted_verified_index_commit();

commit;
