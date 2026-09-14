# Dedicated zero-customer-traffic Ask ECOS agent runtime.
FROM denoland/deno:2.9.2@sha256:69a9f3033e3f381770452648b1cbf4ae96ea409f7ef24f30afeff3d380705f62

ENV DENO_DIR=/app/.deno_cache \
    PORT=8080 \
    ECOS_AGENT_RUNTIME_ENABLED=false

USER root
WORKDIR /app
COPY deno.lock ./deno.lock
COPY supabase/functions/_shared ./supabase/functions/_shared
COPY supabase/functions/ecos-ask-project-candidate ./supabase/functions/ecos-ask-project-candidate
COPY workers/ecos-agent-query-runtime/main.ts ./workers/ecos-agent-query-runtime/main.ts
COPY workers/ecos-agent-query-runtime/startup-smoke.ts ./workers/ecos-agent-query-runtime/startup-smoke.ts
COPY workers/ecos-agent-query-runtime/Dockerfile ./workers/ecos-agent-query-runtime/Dockerfile
RUN mkdir -p /app/.deno_cache && chown -R deno:deno /app

USER deno
RUN deno cache --frozen --lock=deno.lock --no-config --node-modules-dir=none \
    workers/ecos-agent-query-runtime/main.ts \
    workers/ecos-agent-query-runtime/startup-smoke.ts \
    'https://esm.sh/@supabase/phoenix@^0.4.2?target=denonext'

USER root
RUN LC_ALL=C find deno.lock supabase/functions/_shared \
      supabase/functions/ecos-ask-project-candidate \
      workers/ecos-agent-query-runtime -type f \
      ! -name '*.test.ts' -print \
      | LC_ALL=C sort \
      | xargs sha256sum > /app/packaged-sources.sha256 \
    && sha256sum /app/packaged-sources.sha256 | cut -d ' ' -f 1 \
      > /app/ecos-agent-runtime-source.sha256 \
    && chmod -R a-w /app \
    && cat /app/ecos-agent-runtime-source.sha256

USER deno
RUN deno run --no-config --allow-read=/app/workers/ecos-agent-query-runtime/Dockerfile,/app/ecos-agent-runtime-source.sha256 \
    --allow-run=deno --allow-net=127.0.0.1:8080 \
    workers/ecos-agent-query-runtime/startup-smoke.ts
EXPOSE 8080
CMD ["run", "--no-config", "--cached-only", "--node-modules-dir=none", "--no-prompt", "--allow-import=esm.sh:443", "--allow-read=/app/ecos-agent-runtime-source.sha256", "--deny-write", "--deny-run", "--deny-ffi", "--deny-sys", "--allow-env=PORT,ECOS_AGENT_RUNTIME_ENABLED,ECOS_AGENT_PACKAGE_SHA256,ECOS_AGENT_PREVIEW_GATEWAY_TOKEN,SUPABASE_URL,SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,ECOS_SERVICE_WORKER_TOKEN,ECOS_AGENT_MODEL_BRIDGE_URL,ECOS_AGENT_DEEPSEEK_MODEL_BRIDGE_URL,ECOS_EMBEDDING_PROVIDER_URL,ECOS_ASK_MODEL,ECOS_AGENT_MODE,ALLOWED_ORIGINS", "--allow-net=0.0.0.0:8080,xdytqlpsqsseoeuxgzre.supabase.co:443", "workers/ecos-agent-query-runtime/main.ts"]
