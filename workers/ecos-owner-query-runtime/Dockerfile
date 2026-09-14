# Dedicated owner /2.2 server only; no existing query service/traffic is changed.
FROM denoland/deno:2.9.2@sha256:69a9f3033e3f381770452648b1cbf4ae96ea409f7ef24f30afeff3d380705f62

ENV DENO_DIR=/app/.deno_cache \
    PORT=8080 \
    ECOS_OWNER_QUERY_ENABLED=false \
    ECOS_OWNER_SOURCE_VIEW_ENABLED=false

USER root
WORKDIR /app
COPY workers/ecos-query-runtime/deno.lock ./deno.lock
COPY supabase/functions/_shared ./supabase/functions/_shared
COPY workers/ecos-owner-query-runtime/main.ts ./workers/ecos-owner-query-runtime/main.ts
COPY workers/ecos-owner-query-runtime/Dockerfile ./workers/ecos-owner-query-runtime/Dockerfile
RUN mkdir -p /app/.deno_cache && chown -R deno:deno /app

USER deno
# Cache the actual new entrypoint, including PNGjs, using the existing lock.
# No dependency updates or npm lifecycle scripts; runtime network imports denied.
RUN deno cache --no-config --frozen --lock=deno.lock --node-modules-dir=none workers/ecos-owner-query-runtime/main.ts

USER root
# A digest of the exact copied runtime sources/lock/Dockerfile, not a guessed Git
# identity or OCI image digest. No secrets/environment values enter the manifest.
RUN LC_ALL=C find supabase/functions/_shared workers/ecos-owner-query-runtime -type f -print \
      | LC_ALL=C sort \
      | xargs sha256sum > /app/packaged-sources.sha256 \
    && sha256sum deno.lock >> /app/packaged-sources.sha256 \
    && sha256sum /app/packaged-sources.sha256 | cut -d ' ' -f 1 > /app/owner-runtime-source.sha256 \
    && chmod -R a-w /app

USER deno
EXPOSE 8080
CMD ["run", "--no-config", "--frozen", "--lock=deno.lock", "--cached-only", "--node-modules-dir=none", "--no-prompt", "--deny-import", "--allow-read=/app/owner-runtime-source.sha256", "--deny-write", "--deny-run", "--deny-ffi", "--deny-sys", "--allow-env=PORT,ECOS_OWNER_QUERY_ENABLED,ECOS_OWNER_SOURCE_VIEW_ENABLED,ECOS_OWNER_QUERY_ANON_KEY,ECOS_OWNER_QUERY_SERVICE_ROLE_KEY,ECOS_OWNER_QUERY_OPENAI_API_KEY,ECOS_OWNER_QUERY_MODEL,ECOS_OWNER_QUERY_GATEWAY_TOKEN,ECOS_OWNER_QUERY_MODEL_TRANSPORT,ECOS_OWNER_QUERY_BRIDGE_WORKER_TOKEN", "--allow-net=0.0.0.0:8080,xdytqlpsqsseoeuxgzre.supabase.co:443,api.openai.com:443", "workers/ecos-owner-query-runtime/main.ts"]
