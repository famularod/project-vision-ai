do $$
declare
  operational_table text;
begin
  if not exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    raise exception 'Required publication supabase_realtime does not exist';
  end if;

  foreach operational_table in array array[
    'projects',
    'project_updates',
    'project_areas',
    'schedule_items',
    'reference_documents',
    'dave_sync_tombstones'
  ]
  loop
    if to_regclass(format('public.%I', operational_table)) is null then
      raise exception 'Required operational table public.% does not exist',
        operational_table;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = operational_table
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        operational_table
      );
    end if;
  end loop;
end
$$;
