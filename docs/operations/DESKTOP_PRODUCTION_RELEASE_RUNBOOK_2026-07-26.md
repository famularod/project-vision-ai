# Desktop Production Release Runbook

Date: July 26, 2026

Expo project: `@famularod/project-photo-update-tool`

Expo project ID: `38a9bd56-2943-4538-a9bf-1ac6818a3723`

Proposed branded origin:
`https://vitruvius-project-intelligence.expo.app`

## Current state

- The production web export passes and contains 11 static routes.
- The EAS Hosting dry run succeeds and packages the current export.
- The production Expo environment already has the two public Supabase
  variables required by the web client.
- No production web origin is currently configured in the repository.
- The production schedule extractor has Supabase and OpenAI variables, but it
  does not yet have `ALLOWED_ORIGINS`.
- Voice capture already enforces `ALLOWED_ORIGINS`.
- Photo analysis now has the same explicit browser-origin protection on the
  production-readiness branch; native requests without an Origin header remain
  supported.

## Why the production origin is required

The installed desktop experience must not depend on a laptop-only localhost
server. One stable HTTPS origin allows:

- the same deployed app to open from any authorized desktop;
- controlled CORS allowlists for schedule extraction, voice capture, and photo
  analysis;
- a repeatable rollback to an earlier web deployment;
- direct production monitoring and smoke tests.

## Approval-gated deployment sequence

The following actions change external production state and require explicit
approval:

1. Reserve the proposed Expo domain and create the first production deployment:

```sh
npx eas-cli@latest deploy \
  --prod \
  --non-interactive \
  --dev-domain vitruvius-project-intelligence \
  --environment production
```

2. Set the schedule backend production variable:

```text
ALLOWED_ORIGINS=https://vitruvius-project-intelligence.expo.app
```

3. Add the same `ALLOWED_ORIGINS` secret to the linked Supabase project.
4. Deploy the updated `pie-photo-vision` edge function.
5. Redeploy `dave-transcribe-memory` only if its active deployment does not
   already read the new project secret at runtime.
6. Redeploy the schedule backend so the new production environment variable is
   active.

Do not add localhost, wildcard origins, or temporary preview domains to the
production allowlist.

## Production verification

From the proposed HTTPS origin:

1. Sign in and confirm the expected owner account.
2. Confirm two active projects and matching task/document/update totals.
3. Edit a task and verify the iPhone and iPad receive the change.
4. Edit a task on each mobile device and verify desktop receives both changes.
5. Import a schedule and confirm extraction succeeds without a CORS error.
6. Exercise voice capture and confirm the authenticated request succeeds.
7. Exercise photo analysis and confirm approved-origin preflight and POST
   responses include the exact production origin.
8. Send each endpoint an unapproved Origin and confirm HTTP 403 with no wildcard
   access.
9. Confirm sign-out clears the desktop session and protected data.

## Rollback

- Keep the prior EAS Hosting deployment ID before promotion.
- If the desktop smoke test fails, reassign production to the prior deployment.
- Revert the backend and edge-function deployment only if the new functions
  break native clients; retaining a strict allowlist is preferred.
- Keep the last verified native build installed or archived as the rollback
  artifact while Build 113 is being certified.

## Current certification boundary

The web bundle and hosting package are ready. The domain is proposed but not
reserved, and no production deployment or CORS environment change has been
performed.
