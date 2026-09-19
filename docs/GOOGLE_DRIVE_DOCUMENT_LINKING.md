# Google Drive document linking

Vitruvius can keep an original PDF in Google Drive while saving only its Drive
reference, revision metadata, and ECOS search index in Supabase. The original
PDF is downloaded directly from Google Drive into the user's browser for local
indexing and is not copied into the `project-documents` Storage bucket.

## Google Cloud setup

1. Create or choose a Google Cloud project.
2. Enable the Google Picker API and Google Drive API.
3. Configure the OAuth consent screen.
4. Create a Web application OAuth client ID.
5. Add every allowed Vitruvius origin, including the production web origin, to
   Authorized JavaScript origins.
6. Create an API key and restrict it to the Google Picker API and the approved
   website referrers.
7. Record the Google Cloud project number. This is the Picker App ID.
8. Set these build-time variables:

   - `EXPO_PUBLIC_GOOGLE_DRIVE_CLIENT_ID`
   - `EXPO_PUBLIC_GOOGLE_DRIVE_API_KEY`
   - `EXPO_PUBLIC_GOOGLE_DRIVE_APP_ID`

Do not create or embed an OAuth client secret. Browser applications use the
OAuth client ID, and Vitruvius requests the narrow `drive.file` scope so the
user explicitly chooses each file the app may access.

## Security and lifecycle

- Google access tokens stay in browser memory and are not persisted in
  Supabase, local storage, session storage, or Vitruvius backups.
- A moved, deleted, unshared, or download-protected file produces an explicit
  unavailable state instead of silently using stale content.
- Re-indexing asks Google for a fresh short-lived token and verifies the latest
  file metadata before extraction.
- The operational document record intentionally omits page text. Searchable
  pages and regions are stored once in the dedicated ECOS document index.
- Schedule imports continue using protected upload in this phase because their
  task creation and rollback workflow is separate from reference-document
  indexing.

## Release verification

Before enabling the production button, verify:

1. Picker sign-in and PDF-only selection from the production origin.
2. A drawing larger than 50 MB indexes without a Supabase Storage upload.
3. ECOS search returns an exact page or sheet citation after the document is
   made current.
4. Open in Drive and Download both work after a fresh browser session.
5. Revoked access, deleted files, and expired tokens show actionable messages.
6. The `project-documents` bucket does not receive an object for the linked
   document.
