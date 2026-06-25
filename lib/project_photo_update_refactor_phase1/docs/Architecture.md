# Project Photo Update Tool Architecture

## Current milestone

Refactor Phase 1 creates a service layer without changing the app UI.

## Structure

- `App.tsx` remains the main application shell during this phase.
- `lib/supabase.ts` owns the Supabase client.
- `services/projectService.ts` owns cloud project reads/writes.
- `services/updateService.ts` owns cloud saved-update reads/writes.

## Rule going forward

Screens and UI should not call Supabase directly. Cloud operations should live in service files.
