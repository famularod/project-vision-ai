# Vitruvius Build 91 Field Test Plan

**Planned test date:** July 23, 2026
**Clients:** iPhone, iPad, and web
**Release candidate:** Vitruvius 1.0.91 / Build 91

This plan verifies the live behavior that automated tests cannot certify. Use the same signed-in account on all three clients. Keep every client open during synchronization tests unless a step specifically calls for a restart.

## Stop conditions

Stop that test and record a screenshot if any of the following occurs:

- a deleted project, task, update, or schedule returns;
- a task is duplicated;
- an edit reaches web but not the already-open iPhone or iPad;
- task totals differ between clients after the refresh window;
- a completed task changes to incomplete without an explicit user edit;
- Vitruvius reports Connected while known cloud changes are missing;
- an old schedule becomes Current without the user selecting it;
- a report contradicts the visible task or schedule record;
- touch response regularly exceeds two seconds;
- a saved note, date, area, or status differs from what the user entered.

For every failure, record the time, source device, destination devices, project, task or document name, action taken, visible result, and screenshots from all affected clients.

## 1. Installation and identity

- [ ] iPhone About screen shows version 1.0.91 and Build 91.
- [ ] iPad About screen shows version 1.0.91 and Build 91.
- [ ] Both native apps open without reinstalling, clearing data, or losing the signed-in account.
- [ ] Vitruvius branding, V icon, and “Project Intelligence” wording match across iPhone, iPad, and web.
- [ ] Only the two intended active projects appear.
- [ ] No archived or deleted project reappears after a restart.

## 2. Baseline truth and totals

Before making edits, write down the totals shown by each client.

| Client | Active projects | Total tasks | Complete | Open | Overdue | Due soon | Documents |
|---|---:|---:|---:|---:|---:|---:|---:|
| iPhone |  |  |  |  |  |  |  |
| iPad |  |  |  |  |  |  |  |
| Web |  |  |  |  |  |  |  |

- [ ] Total tasks equal Complete plus Open on every client.
- [ ] Portfolio, project, task-list, attention, and report counts agree.
- [ ] Completed tasks do not appear in open/attention lists unless a separate current condition genuinely requires review.
- [ ] Deleted tasks and prior schedule versions are excluded from current totals.

## 3. Live three-client synchronization

Perform each row while the other two clients remain open. Allow the normal refresh window; do not restart an app to make the change appear.

| Source | Change | iPhone receives | iPad receives | Web receives |
|---|---|---|---|---|
| iPhone | Rename an incomplete test task | N/A | [ ] | [ ] |
| iPad | Change its area | [ ] | N/A | [ ] |
| Web | Change percent and status | [ ] | [ ] | N/A |
| iPhone | Change start and finish dates | N/A | [ ] | [ ] |
| iPad | Add a multi-word note | [ ] | N/A | [ ] |
| Web | Complete the task | [ ] | [ ] | N/A |
| iPhone | Reopen it to In Progress below 100% | N/A | [ ] | [ ] |

- [ ] No peer needs to close or restart.
- [ ] No duplicate task appears.
- [ ] No older value overwrites a newer value.
- [ ] The Connection/Cloud Sync state matches reality on each client.

## 4. Offline queue and automatic retry

- [ ] Put iPhone offline, edit a task area, and save.
- [ ] The app clearly identifies the pending change without pretending it is cloud-confirmed.
- [ ] Restore connectivity without making another edit.
- [ ] The queued change retries automatically and clears.
- [ ] The already-open iPad and web clients receive it without restart.
- [ ] Repeat with one field update or document metadata edit.
- [ ] Retry does not create a duplicate task, update, or document.

## 5. Task creation, editing, grouping, and deletion

- [ ] Add Task is easy to find on iPhone, iPad, and web.
- [ ] Project, area, owner, and contractor offer existing choices and still permit typed values where designed.
- [ ] Start Date and Finish/Due Date use calendar selection.
- [ ] Notes preserve spaces, punctuation, and multiple lines.
- [ ] Task cards are grouped Project → Area under All Projects.
- [ ] Completed Tasks uses the same Project → Area grouping.
- [ ] A completed 100% task can be deliberately reopened and edited.
- [ ] Changing Area saves and reaches both peer clients.
- [ ] Delete a disposable test task; its historical evidence remains clearly historical but does not change active totals or reports.
- [ ] Restart all clients and confirm the deleted task does not return.

## 6. Schedule workflow

Use a disposable but representative schedule PDF that addresses both projects.

- [ ] Upload the schedule once and select both projects.
- [ ] Both projects receive one shared schedule record rather than duplicate schedule/task sets.
- [ ] Extraction starts automatically and visibly.
- [ ] Extracted tasks populate without manual sync or restart.
- [ ] Imported task count and project assignment are plausible before approval.
- [ ] Select the new schedule as Current.
- [ ] Every client shows the same Current schedule and the prior schedule as Prior.
- [ ] A first standalone permit/drawing is labeled as a document, not “Prior version.”
- [ ] Delete a prior schedule and restart all clients; it remains deleted.
- [ ] Current schedule protection prevents accidental deletion or requires an intentional replacement first.

## 7. Areas, GPS, and field updates

- [ ] Each project shows only its own applicable areas.
- [ ] Overlapping area names do not leak records between projects.
- [ ] Add Field Update allows the area to be selected or changed directly.
- [ ] A saved area change remains correct after synchronization and restart.
- [ ] GPS saved counts match between iPhone and iPad after both receive the same cloud record.
- [ ] A stale GPS result cannot attach to a different draft, project, or later capture.
- [ ] Save one update with a photo and one without a photo; both appear once on all clients.

## 8. Photo intelligence

- [ ] Open the known Canopy C same-area/different-angle comparison.
- [ ] The provider either returns a useful comparison or preserves the specific failure; it never replaces the cause with a generic unavailable message.
- [ ] Retry analyzes the intended current photo and prior photo only.
- [ ] Switching projects or drafts during analysis cannot attach the result to the wrong update.
- [ ] Web displays the authorized photo rather than only a placeholder.
- [ ] Missing/expired cloud photo access shows a clear unavailable state and does not expose a local-device file path.
- [ ] PM-facing text distinguishes visible observation from interpretation and does not claim hidden work is complete.

## 9. Documents

- [ ] Uploading asks what the document is before it enters the project record.
- [ ] Schedule, permit, drawing, scope, contract, inspection, safety, compliance, RFI/field decision, vendor document, and Other classifications save correctly.
- [ ] Web can open/download an authorized document with a temporary protected link.
- [ ] Missing document bytes are recovered from the trusted cloud copy or produce a clear re-add-original message.
- [ ] Deleting a document creates a durable deletion marker; restart and sync do not restore it.

## 10. Reports and project intelligence

- [ ] Generate a report for each project after task and schedule changes finish syncing.
- [ ] Project totals, completion, overdue work, current schedule, areas, and latest updates match the visible record.
- [ ] A completed CURE task is not called out as current attention without a separate current reason.
- [ ] Deleted-task evidence does not affect active totals or recommendations.
- [ ] Approving a report does not immediately make the same unchanged report stale.
- [ ] A later material task, photo-intelligence, GPS, or schedule change does mark the prior report for refresh.
- [ ] Language is useful to a project manager and avoids internal phrases such as “correlated across multiple source types.”
- [ ] Review & Approval presents decisions and material risks, not a list of system limitations.

## 11. Web continuity and responsive layout

- [ ] Start editing a task, then trigger Refresh; entered values remain unless the save is intentionally cancelled.
- [ ] Simulate a temporary failed refresh; the verified workspace stays visible and changes to Reconnecting/Stale rather than returning to sign-in.
- [ ] Switch project scope while a task, upload, or report draft is open; the prior project’s draft cannot be saved under the new project.
- [ ] Check 320, 375, 390, 768, and desktop widths plus 200% browser zoom.
- [ ] No page-level horizontal scrolling, clipped actions, white-on-white boundaries, or unreadable status badges appear.
- [ ] Settings connection copy agrees with the header connection state.

## 12. Responsiveness and accessibility

- [ ] Cold launch reaches a usable Overview without a long frozen interval.
- [ ] Repeated taps among Overview, Tasks, Documents, Talk, and Reports respond within two seconds.
- [ ] Scrolling task and evidence lists remains smooth with the real project data.
- [ ] VoiceOver identifies date fields, task choices, status/priority choices, upload controls, and destructive actions.
- [ ] Selected choices are announced as selected.
- [ ] Essential controls are comfortably tappable and do not clip with larger text.

## Completion record

| Area | Pass | Fail | Not tested | Notes/evidence |
|---|---:|---:|---:|---|
| Installation and identity |  |  |  |  |
| Baseline truth and totals |  |  |  |  |
| Three-client synchronization |  |  |  |  |
| Offline retry |  |  |  |  |
| Tasks |  |  |  |  |
| Schedules |  |  |  |  |
| Areas/GPS/updates |  |  |  |  |
| Photo intelligence |  |  |  |  |
| Documents |  |  |  |  |
| Reports |  |  |  |  |
| Web |  |  |  |  |
| Responsiveness/accessibility |  |  |  |  |

Build 91 is ready for broader testing only after every Critical stop-condition scenario passes. A local automated PASS does not replace this evidence.
