-- Expand only managed-original admission for the sealed-FD worker profile.
-- No authorization, output, page, claim, publication or storage-key changes.
-- The exact previous function body is captured in research/large-original-validator-before.sql.
DO $guard$
BEGIN
  IF encode(sha256(convert_to(pg_get_functiondef('ecos_private.validate_managed_original_attestation(jsonb)'::regprocedure),'UTF8')),'hex') <> 'b1f2f53b20b1c21be74bb9717b840efead315307632def97152f67e2f3ebe631' THEN
    RAISE EXCEPTION 'Managed-original validator changed; review fresh state before migration';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION ecos_private.validate_managed_original_attestation(a jsonb)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare k text;expected text[]:=array['schema_version','publication_mode','owner_id','organization_id','project_id','source_id','attempt_id',
  'expected_previous_attempt_id','authority_decision_id','authority_receipt_sha256','source_generation','source_metadata_sha256','original_locator_sha256',
  'source_revision','content_sha256','source_id_sha256','byte_length','measured_page_count','project_url','bucket','object_key','verification','retrieval_authorized'];
begin
  if jsonb_typeof(a) is distinct from 'object' or octet_length(a::text)>16384 or not(a ?& expected)
    or exists(select 1 from jsonb_object_keys(a) key where not(key=any(expected)))
    or a->>'schema_version' is distinct from 'ecos-managed-original-attestation/2.0'
    or a->>'publication_mode' is distinct from 'shadow' or a->'retrieval_authorized' is distinct from 'false'::jsonb
    or a->>'verification' is distinct from 'exact_bytes_sha256_and_independent_pdf_page_count'
    or a->>'project_url' is distinct from 'https://xdytqlpsqsseoeuxgzre.supabase.co'
    or a->>'bucket' is distinct from 'project-documents' then
    raise exception using errcode='22023',message='Exact managed-original attestation required';end if;
  foreach k in array array['owner_id','organization_id','project_id','authority_decision_id'] loop
    if jsonb_typeof(a->k) is distinct from 'string' or a->>k !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
      raise exception using errcode='22023',message='Exact managed-original identity required';end if;
  end loop;
  if a->>'organization_id' is distinct from a->>'owner_id' or jsonb_typeof(a->'attempt_id') is distinct from 'string'
    or a->>'attempt_id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
    or not public.ecos_v2_inventory_exact_text(a->>'source_id',300) or jsonb_typeof(a->'source_id') is distinct from 'string'
    or (a->'expected_previous_attempt_id'<>'null'::jsonb and (jsonb_typeof(a->'expected_previous_attempt_id')<>'string'
      or a->>'expected_previous_attempt_id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'))
    or a->>'expected_previous_attempt_id'=a->>'attempt_id'
    or(a->'source_revision'<>'null'::jsonb and(jsonb_typeof(a->'source_revision')<>'string' or not public.ecos_v2_inventory_exact_text(a->>'source_revision',300))) then
    raise exception using errcode='22023',message='Exact managed-original scope required';end if;
  foreach k in array array['authority_receipt_sha256','source_metadata_sha256','original_locator_sha256','content_sha256','source_id_sha256'] loop
    if jsonb_typeof(a->k) is distinct from 'string' or a->>k !~ '^[a-f0-9]{64}$' then
      raise exception using errcode='22023',message='Exact managed-original hash required';end if;
  end loop;
  foreach k in array array['source_generation','byte_length','measured_page_count'] loop
    if jsonb_typeof(a->k) is distinct from 'number' or a->>k !~ '^(0|[1-9][0-9]{0,9})$' then
      raise exception using errcode='22023',message='Exact managed-original integer required';end if;
  end loop;
  if (a->>'source_generation')::numeric>2147483647 or (a->>'byte_length')::numeric not between 5 and 167772160
    or (a->>'measured_page_count')::numeric not between 1 and 10000
    or a->>'source_id_sha256'<>encode(sha256(convert_to(a->>'source_id','UTF8')),'hex')
    or a->>'object_key' is distinct from 'v2-originals/'||(a->>'owner_id')||'/'||(a->>'source_id_sha256')||'/'||(a->>'content_sha256')||'/'||(a->>'attempt_id')||'.pdf' then
    raise exception using errcode='22023',message='Managed-original bounds or object identity mismatch';end if;
end;$function$
