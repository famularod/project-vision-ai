begin;

-- Delegating multiple trigram searches inside one statement exceeded the
-- hosted statement timeout even at four queries. Keep the proven single-query
-- authority and let the caller bound independent requests instead.
drop function if exists public.ecos_search_hosted_shadow_chunks_v23(
  text[], text[], integer, integer
);

commit;
