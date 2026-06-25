# Project Vision AI Architecture

## Current milestone

Version 0.7 starts moving the app away from a single large `App.tsx` file and toward a service-based architecture.

## Current structure

- `App.tsx` remains the main application shell and UI container.
- `lib/supabase.ts` owns Supabase client creation.
- `services/projectService.ts` owns cloud project reads and writes.
- `services/updateService.ts` owns cloud saved-update reads and writes.

## Near-term direction

Future refactor phases should split the app into:

- `screens/` for top-level screens.
- `components/` for reusable UI.
- `hooks/` for reusable state and side effects.
- `services/` for data and integration logic.
- `types/` for shared TypeScript contracts.
- `utils/` for formatting, parsing, and pure helper functions.

## Design rule

Screens and UI components should not call Supabase directly. They should call service functions.
