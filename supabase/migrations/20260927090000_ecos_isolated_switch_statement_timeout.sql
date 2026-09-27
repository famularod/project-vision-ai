-- Owner-approved 27 Sep 2026. The isolated page switch (and its exact undo)
-- write a whole page's search vectors (up to 512 x 1536) in one statement into
-- an HNSW-indexed table; through the REST API that inherits the service role's
-- short statement timeout and was cancelled on the first real page (26 Sep,
-- "canceling statement due to statement timeout"). A function-level SET clause
-- is honoured for RPC calls; nothing else about either function changes.
alter function public.ecos_switch_isolated_page_refresh(uuid, jsonb) set statement_timeout = '120s';
alter function public.ecos_rollback_isolated_page_refresh(uuid) set statement_timeout = '120s';

-- undo:
-- alter function public.ecos_switch_isolated_page_refresh(uuid, jsonb) reset statement_timeout;
-- alter function public.ecos_rollback_isolated_page_refresh(uuid) reset statement_timeout;
