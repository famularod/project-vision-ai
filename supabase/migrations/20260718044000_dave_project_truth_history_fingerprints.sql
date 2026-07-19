-- Preserve append-only Project Truth history when a project returns to a prior
-- semantic state (A -> B -> A). Only the current head is deduplicated by the
-- repository; historical fingerprints are intentionally repeatable.

begin;

do $migration$
declare
  fingerprint_constraint text;
begin
  for fingerprint_constraint in
    select constraint_record.conname
    from pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.dave_project_truth_snapshots'::regclass
      and constraint_record.contype = 'u'
      and (
        select array_agg(attribute_record.attname order by key_record.ordinality)
        from unnest(constraint_record.conkey) with ordinality
          as key_record(attribute_number, ordinality)
        join pg_attribute as attribute_record
          on attribute_record.attrelid = constraint_record.conrelid
         and attribute_record.attnum = key_record.attribute_number
      ) = array['owner_id', 'project_id', 'source_fingerprint']::name[]
  loop
    execute format(
      'alter table public.dave_project_truth_snapshots drop constraint %I',
      fingerprint_constraint
    );
  end loop;
end
$migration$;

create index if not exists dave_project_truth_fingerprint_history_idx
  on public.dave_project_truth_snapshots (
    owner_id,
    project_id,
    source_fingerprint,
    revision desc
  );

comment on index public.dave_project_truth_fingerprint_history_idx is
  'Non-unique lookup history; A-to-B-to-A Project Truth revisions are valid.';

commit;
