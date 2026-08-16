-- Keep desktop sign-in bounded when operational document rows contain large
-- embedded page indexes. The owner receives the same document metadata with
-- only the redundant extracted page/text payload omitted; page evidence stays
-- authoritative in the dedicated ECOS page tables.

begin;

create or replace function public.dave_list_reference_document_metadata()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '60s'
as $$
declare
  current_owner uuid := auth.uid();
  document_count integer;
  result jsonb;
begin
  if current_owner is null or not public.dave_is_app_owner() then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  select count(*)
  into document_count
  from public.reference_documents source
  where source.owner_id = current_owner;

  if document_count > 500 then
    raise exception 'Reference document metadata limit exceeded';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', source.id,
        'owner_id', source.owner_id,
        'name', source.name,
        'category', source.category,
        'updated_at', source.updated_at,
        'document_data', coalesce(source.document_data, '{}'::jsonb)
          - 'extractedPages'
          - 'extractedText'
      )
      order by source.updated_at desc
    ),
    '[]'::jsonb
  )
  into result
  from public.reference_documents source
  where source.owner_id = current_owner;

  return result;
end;
$$;

revoke all on function public.dave_list_reference_document_metadata()
  from public, anon;
grant execute on function public.dave_list_reference_document_metadata()
  to authenticated;

commit;
