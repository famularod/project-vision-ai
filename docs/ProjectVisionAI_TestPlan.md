# Project Vision AI Test Plan

## Purpose

This manual test plan defines the first repeatable checks for Project Vision AI. These cases should be run before release handoffs and gradually converted into automated tests.

Use this plan with the Design Standard. A test passes only when the feature works and the workflow remains clear, readable, and aligned with the 60-second rule.

## General Pre-Test Setup

- Install dependencies.
- Run `npm run check`.
- Start the app with `npm start` or the normal Expo workflow.
- Test on an iPhone-sized simulator or physical device.
- Use sample data with at least one active project, one saved update, one photo, one report path, and one schedule import when possible.

## Home

### HOME-001: Bottom Navigation Stability

Steps:

- Open the app.
- Confirm bottom navigation shows Home, Projects, Capture, Reports, More.
- Tap each tab and return to Home.

Expected result:

- All tabs remain visible and stable.
- Home opens without admin/debug clutter.

### HOME-002: Start Capture in Two Taps

Steps:

- Open Home.
- Tap Capture Update or the Capture tab.
- Confirm the capture flow starts.

Expected result:

- Capture starts in two taps or fewer.
- The project is prefilled or easy to confirm when possible.

### HOME-003: Attention and Recent Activity

Steps:

- Open Home with sample project data.
- Review current or last active project.
- Review projects needing attention and recent activity.

Expected result:

- Home answers "what should I do next?"
- Text is readable and cards do not overlap.

## Projects

### PROJ-001: Find Project

Steps:

- Open Projects.
- Search for an active project.
- Clear the search.
- Use filters such as Favorites, Open, Overdue, Due Soon, and Archived.

Expected result:

- Project search and filters remain readable.
- A project can be found in under 15 seconds.

### PROJ-002: Project Card Standard

Steps:

- Review an active project card.
- Confirm project name, status signals, open/overdue counts, schedule status, and next task are visible when data exists.
- Confirm Update is the primary visible action.
- Open More actions.

Expected result:

- Administrative actions do not dominate the card.
- Rename, Archive, and Delete remain accessible through More.

### PROJ-003: Project Lifecycle Actions

Steps:

- Add a project.
- Rename it.
- Favorite it.
- Archive it.
- Restore it.
- Delete it.

Expected result:

- Lifecycle actions work.
- Destructive delete requires confirmation.

## Project Overview

### OVERVIEW-001: Project Opens to Overview

Steps:

- Open Projects.
- Tap a project row.

Expected result:

- The first project screen is Project Overview.
- The title says Project Overview.

### OVERVIEW-002: Summary Content

Steps:

- Open Project Overview.
- Review Project Summary.

Expected result:

- The screen shows project health, progress, schedule status, open issues, critical issues, safety status, next milestone, latest update, and last update.
- If no schedule exists, progress does not show 0%; it shows a clear placeholder such as Schedule Required.

### OVERVIEW-003: What Changed

Steps:

- Open Project Overview with saved updates.
- Review What's Changed.
- Repeat with no updates.

Expected result:

- New Photos, Completed Tasks, New Issues, Closed Issues, Safety Updates, and Latest Update Time are visible.
- Missing data shows clear placeholder text.

### OVERVIEW-004: Recommended Next Action

Steps:

- Open Project Overview with different project conditions: safety issue, overdue schedule item, open issue, upcoming milestone, and no risk.

Expected result:

- Recommended Next Action displays an action, not just an observation.
- Recommendations are readable and project-management oriented.

### OVERVIEW-005: Quick Actions

Steps:

- Tap Capture Update.
- Return and tap Generate Report.
- Return and tap View Timeline.

Expected result:

- All actions navigate to the existing feature.
- No existing reports, schedules, AI, documents, or timeline functionality is removed.

## Capture

### CAP-001: Start Capture

Steps:

- Tap Capture from bottom navigation.
- Select or confirm a project.

Expected result:

- Capture opens quickly.
- Project context is remembered or easy to select.

### CAP-002: Save Update with Photo

Steps:

- Add a photo.
- Add caption, category, area, notes, and action fields if needed.
- Save the update.

Expected result:

- Update is saved.
- Recent activity and project overview reflect the update.

### CAP-003: Outdoor Readability

Steps:

- Review Capture screens on iPhone size.

Expected result:

- Buttons and text are large enough for field use.
- No labels are tiny or overlapping.

## Reports

### REP-001: Reports Hub

Steps:

- Tap Reports in bottom navigation.

Expected result:

- A dedicated Reports screen opens.
- Report cards are large and readable.

### REP-002: Real Report Paths

Steps:

- Tap Generate Executive Report.
- Tap Weekly Executive Report.
- Tap Project Health Report.
- Tap Saved Updates / History.

Expected result:

- Implemented report cards navigate to real screens.
- Existing history/report functionality is preserved.

### REP-003: Placeholder Report Paths

Steps:

- Tap any report card that is not implemented yet.

Expected result:

- The app shows a clear Coming Soon placeholder.
- The user is not sent to an unrelated or blank screen.

## More/Admin

### ADMIN-001: Admin Tool Placement

Steps:

- Open More.
- Locate diagnostics, sync, test connection, cloud status, and backup/restore.

Expected result:

- Admin/debug tools are available in More/Admin.
- They are not cluttering Home.

### ADMIN-002: Diagnostics

Steps:

- Open Diagnostics.
- Run available connection or sync diagnostics.

Expected result:

- Results are understandable.
- Sensitive keys are not exposed.

### ADMIN-003: Backup and Restore

Steps:

- Export a backup.
- Import a valid backup.

Expected result:

- Backup/restore remains available.
- Restore does not break projects, updates, photos, or schedules.

## Schedule Upload

### SCHED-001: Upload Schedule

Steps:

- Open Schedule.
- Upload or import a construction schedule.

Expected result:

- A success message appears.
- Imported item count is visible.
- Milestone count is visible.
- Overdue count is visible.
- Upcoming 7, 14, and 30 day counts are visible.

### SCHED-002: Schedule Summary

Steps:

- After upload, open Schedule Summary.

Expected result:

- Upcoming tasks, overdue tasks, completed tasks, milestones, tasks by project, tasks by area, critical path items when available, and missing mapping items are visible.

### SCHED-003: Schedule Data Propagation

Steps:

- Return to Home.
- Open Projects.
- Open Project Overview.
- Open Reports.

Expected result:

- Schedule attention appears where relevant.
- Project cards show schedule indicators.
- Reports include schedule summary or risks where implemented.

## Cloud Sync

### SYNC-001: Cloud Status

Steps:

- Open More/Admin.
- Review cloud status.

Expected result:

- Supabase configuration and connection status are understandable.
- Cloud status is not displayed as daily-use clutter on Home.

### SYNC-002: Sync Now

Steps:

- Open More/Admin.
- Tap Sync Now.

Expected result:

- Sync action runs or gives a clear configuration error.
- Local project storage remains intact.

### SYNC-003: Offline Tolerance

Steps:

- Disable network.
- Create or review local project data.

Expected result:

- Local project workflows remain usable when possible.
- Cloud errors do not block ordinary local review.

## AI

### AI-001: AI Coach Opens

Steps:

- Open AI Coach from an available entry point.

Expected result:

- AI Coach opens.
- Local deterministic recommendations or placeholders are visible when external AI is unavailable.

### AI-002: Executive Brief AI Path

Steps:

- Open Reports.
- Start Generate Executive Report.

Expected result:

- Executive report path opens.
- AI use is explicit.
- The app does not invent project facts.

### AI-003: Schedule Context

Steps:

- Import schedule items.
- Open AI Coach or report analysis.

Expected result:

- Schedule risks and overdue work are included where implemented.
- Missing AI data produces clear placeholder text.

## Talk-to-Text Future Feature

### TALK-001: Entry Point

Steps:

- Locate the future Talk-to-Text entry point when implemented.

Expected result:

- The entry point is easy to find from Capture.
- It does not add clutter to Home.

### TALK-002: Dictate Update

Steps:

- Start Talk-to-Text.
- Dictate a project update.
- Review the generated text before saving.

Expected result:

- User remains in control.
- The app proposes structured update content without saving blindly.

### TALK-003: Context Defaults

Steps:

- Start Talk-to-Text after using a project and area previously.

Expected result:

- Last project, last area, date, time, and available context are prefilled when possible.
- The user rarely needs to make the same selection twice.

## Automation Candidates

Good first Maestro candidates:

- HOME-001
- HOME-002
- PROJ-001
- OVERVIEW-001
- OVERVIEW-005
- REP-001
- ADMIN-001
- SCHED-001

Good first Jest/RNTL candidates after tooling is installed:

- Project card rendering
- Project Overview placeholder states
- Reports Hub card states
- Schedule summary utility behavior
- Recommended Next Action selection
