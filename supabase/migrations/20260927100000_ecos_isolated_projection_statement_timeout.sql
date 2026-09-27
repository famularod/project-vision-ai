-- Owner-approved 27 Sep 2026 (second DB change). The switch itself now runs
-- (20260927090000), but the read-only projection check the page switch calls
-- over the REST API hit the same short service-role statement timeout on a
-- larger page. Same function-level setting; nothing else changes.
alter function public.ecos_isolated_region_projection(jsonb, jsonb, uuid) set statement_timeout = '120s';

-- undo:
-- alter function public.ecos_isolated_region_projection(jsonb, jsonb, uuid) reset statement_timeout;
