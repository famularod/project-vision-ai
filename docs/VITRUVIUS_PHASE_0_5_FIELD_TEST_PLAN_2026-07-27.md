# Vitruvius Phase 0–5 Field Test Plan

Date: July 28, 2026

Release candidate: Vitruvius 1.0.126 (Build 126)

Platforms: iPhone, iPad, and desktop web app

## Purpose

Verify the new project-controls foundation with real jobsite data while
protecting the existing project record. Use one disposable task or project item
for workflow tests. Do not delete or rewrite an active schedule merely to
complete this plan.

## Before testing

1. Confirm all three clients are signed into the same account.
2. Open the same project on iPhone, iPad, and desktop.
3. Record the project, open-task, completed-task, and document counts.
4. Confirm the clients agree before creating the disposable test item.
5. Use **Field Controls Test — Delete After Review** as the disposable item
   name so it is easy to identify.

## Phase 0 — shared-record trust

- Edit the disposable item's note on iPhone. Confirm iPad and desktop update
  without closing or restarting either app.
- Edit its area on iPad. Confirm iPhone and desktop update.
- Edit its priority on desktop. Confirm iPhone and iPad update.
- Confirm project/task/document counts remain identical on all three clients.
- Put one mobile device offline, make a note edit, return online, and confirm
  the edit uploads once without creating a duplicate.

Pass: every client converges on one task record and the totals remain equal.

## Phase 1 — accountability and My Work

- Assign the disposable item to the signed-in user's exact display name. Open
  **My Work** on mobile and desktop and confirm it appears.
- Reassign it to a different person. Confirm it leaves the original user's My
  Work view even if the legacy Owner field still contains the original name.
- Clear both Assigned To and Owner. Confirm the Unassigned count increases by
  one, then restore the assignment.
- Add a trade/company, watcher, and approver. Confirm spaces remain intact and
  all three clients display the same values.

Pass: assignment is authoritative, personal work is accurate, and reassigned
work is not shown to a former owner.

## Phase 2 — structured workflows

Repeat the close/reopen check with at least an RFI and a Submittal.

- Change the disposable item's type to **RFI**.
- Add an RFI reference, responsible person, response due date, and closing
  note.
- Try to close it while one required value is missing. Confirm Vitruvius
  explains what is missing and does not mark it Complete.
- Add the missing value, close the RFI, and confirm status, progress, workflow
  stage, and activity history change together.
- Reopen it with the workflow button. Confirm it returns to active work.
- For a Submittal, verify approver, responsible trade, linked approved
  document, and Approved status are required before close.
- Create a **Meeting**, **Risk**, and **Transmittal**. Confirm each one starts
  with its recommended checklist:
  - Meeting: attendees, decisions, action items, and distributed minutes.
  - Risk: trigger, impact, mitigation owner, and mitigation verification.
  - Transmittal: recipients, linked documents/revisions, and receipt.
- Open **My Reviews** as the named approver. Confirm Pending and Changes
  Requested records appear and Approved/Rejected records do not.
- Confirm a closed structured item cannot silently become a different item
  type or be reopened by typing a lower percent.

Pass: Complete/100% is reachable only through the structured close workflow,
reopen is explicit and recorded, and the personal review queue contains only
the signed-in user's open approvals.

## Phase 3 — field controls

- Create a Daily Log and record its date and field summary.
- Add two checklist items to an Inspection or Quality Check.
- Complete one checklist item on iPhone and the other on iPad.
- Link one Drawing or Document reference and one Photo or Schedule reference.
- Upload a Drawing and record its drawing number, revision, discipline, issue
  status, and issue date. Confirm those fields survive synchronization.
- Add a crew and one equipment resource.
- Confirm the checklist, linked records, resources, and revision attribution
  agree on all three clients.

Pass: no checklist item, linked record, or resource disappears after another
device edits a different control.

## Phase 4 — schedule change preview

Use desktop Schedule Builder on a disposable or safely editable task.

- Set a finish date before the start date. Confirm the preview says the change
  needs correction and Save is disabled.
- Correct the dates and review downstream-task, project-finish, and
  critical-path changes before saving.
- Open Gantt → Impact Preview and apply a reviewed downstream date change.
- Confirm an existing task's Project field is locked while editing so
  project-specific dependencies cannot be moved without review.
- Confirm the updated dates appear on iPhone and iPad.

Pass: unsafe changes cannot save, safe changes show their likely effect, and
no task is silently transferred between projects.

## Phase 5 — portfolio workflow signals

Cost and payroll are deliberately outside this release.

- Use the **Work type** filter on iPhone, iPad, and desktop to show Meetings,
  Risks, Transmittals, RFIs, Submittals, and Punch Lists independently.
- Mark one item approval Pending and another Changes Requested. Confirm
  **My Reviews** identifies both only for the listed approver.
- Set a schedule-impact estimate, confidence, and plain-language impact note.
  Confirm the information remains attached to the correct project item after
  another device edits a different control.
- Close the test item and confirm it leaves open work/review queues and remains
  available under Completed Tasks.

Pass: operational queues and filters are consistent across all three clients,
with no cost or payroll fields shown.

## Concurrent-edit test

This is the most important new regression test.

1. Open the same disposable task on iPhone and iPad.
2. On iPhone, change Assigned To.
3. Before restarting either device, on iPad complete a checklist item.
4. On desktop, add an impact note.
5. Wait for automatic synchronization.
6. Confirm all three changes survive on all three clients.
7. Repeat once with two devices editing the same control value. Confirm the
   final value is deterministic or Vitruvius presents a visible conflict; it
   must never silently retain three different versions.

## Responsiveness and layout

- Navigate Overview → Tasks → one task → Reports five times on iPhone and iPad.
- Confirm ordinary taps react promptly and no transition regularly takes more
  than two seconds.
- Check the project-controls editor with the keyboard open on iPhone.
- Check desktop at normal size and 200% zoom.
- Confirm buttons, status labels, checklists, and impact fields remain readable.

## Cleanup

- Delete only the disposable items created for this plan.
- Confirm they disappear from all three clients and do not return after
  restart.
- Confirm the original baseline counts return, except for intentionally retained
  test history.

## Stop and report immediately if

- any client requires restart before receiving ordinary task changes;
- a prior project or deleted task returns;
- one edit erases an unrelated edit from another device;
- a structured item reaches Complete without satisfying its close checks;
- counts differ after synchronization settles;
- the app freezes, loses keyboard spaces, or needs repeated taps.
