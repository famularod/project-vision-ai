-- ECOS sheet-provenance trigger-function execute hardening
--
-- These SECURITY DEFINER functions are invoked only by database triggers.
-- PostgreSQL does not require callers that fire a trigger to hold direct
-- EXECUTE on its trigger function, so the exposed API roles do not need it.

begin;

revoke all on function public.ecos_prepare_legacy_page_sheet_provenance()
  from public, anon, authenticated;
revoke all on function public.ecos_prepare_hosted_page_sheet_provenance()
  from public, anon, authenticated;
revoke all on function public.ecos_enrich_legacy_chunk_sheet_provenance()
  from public, anon, authenticated;
revoke all on function public.ecos_enrich_hosted_chunk_sheet_provenance()
  from public, anon, authenticated;
revoke all on function public.ecos_enrich_shadow_chunk_sheet_provenance()
  from public, anon, authenticated;

grant execute on function public.ecos_prepare_legacy_page_sheet_provenance()
  to service_role;
grant execute on function public.ecos_prepare_hosted_page_sheet_provenance()
  to service_role;
grant execute on function public.ecos_enrich_legacy_chunk_sheet_provenance()
  to service_role;
grant execute on function public.ecos_enrich_hosted_chunk_sheet_provenance()
  to service_role;
grant execute on function public.ecos_enrich_shadow_chunk_sheet_provenance()
  to service_role;

commit;
