# Project Vision AI Design Standard

## 1. Product Mission

Project Vision AI exists to reduce the time it takes a project manager to understand, communicate, and make decisions about a project.

The app should turn field information, project history, photos, schedules, and risks into useful decisions faster than a project manager could assemble that context manually.

## 2. Core Design Rule

Every primary workflow must be completed in under 60 seconds.

If a workflow cannot reasonably be completed in under 60 seconds, the design must be simplified, split into smaller steps, or moved out of the primary daily workflow.

## 3. Value Rule

Every screen, feature, and workflow must do at least one of the following:

- Capture meaningful project information
- Transform information into insight
- Help someone make a better project decision
- Improve communication with bosses, customers, contractors, or project stakeholders

Features should not be added only because they are possible. Every addition must create clear project-management value.

## 4. Design Principle: Reduce Decisions

The application should make intelligent assumptions using available project data rather than repeatedly asking the user for information.

Project Vision AI should reduce user decisions whenever a reasonable default, previous selection, location signal, schedule signal, or project context can determine the answer.

The user should confirm or correct important context when needed, but the app should not require manual input for information it can determine automatically.

## 5. Project Context Intelligence

Project Vision AI should automatically determine as much context as possible without requiring user input.

Users should never be required to enter information the application can determine automatically.

Automatically determine when possible:

- GPS Location
- Project
- Project Area
- Building
- Zone
- Date
- Time
- User
- Weather
- Previous Active Project
- Current Schedule Activity

The purpose is to reduce user decisions and support the 60-second workflow.

## 6. Location Philosophy

Locations are not a primary user workflow.

Locations should become background intelligence rather than a destination.

Users think in terms of projects.

The application thinks in terms of locations.

Location data should automatically identify:

- Project
- Area
- Building
- Zone

without requiring manual selection whenever practical.

## 7. Automatic Defaults

The application should remember previous selections whenever possible.

Examples:

- Last Project
- Last Area
- Preferred Recipients
- Preferred Report Type
- Previous Capture Area

The user should rarely need to make the same selection twice.

## 8. User Roles

### Field Technician

Needs:

- Capture field work quickly
- Attach photos with useful context
- Record issues, safety concerns, completed work, and next steps
- Avoid long forms while in the field
- Use large controls that are readable outdoors

Primary value:

- Document what happened accurately and quickly.

### Project Manager

Needs:

- Understand what changed across projects
- Find the right project fast
- Capture updates in the field or from notes
- Identify overdue work, open issues, schedule risk, and communication needs
- Generate updates and reports without retyping information

Primary value:

- Turn project data into action, decisions, and communication.

### Executive

Needs:

- See project health quickly
- Understand risk, delays, blockers, and decisions needed
- Review concise summaries instead of raw field notes
- Compare project status across a portfolio

Primary value:

- Know what needs attention and what decisions are required.

### Customer

Needs:

- Receive clear, trustworthy project status
- Understand what is complete, what changed, and what is next
- See relevant photos and evidence
- Avoid internal admin/debug information

Primary value:

- Get confidence that the project is understood and actively managed.

## 9. Navigation Standards

Use this bottom navigation:

Home | Projects | Capture | Reports | More

### Home

Purpose: What should I do next?

Home should show the current or last active project, the fastest path to capture an update, project attention items, schedule attention items, and recent activity.

Home should use context intelligence and automatic defaults to guide the user toward the most likely next action.

Home should not contain admin, diagnostics, developer, or configuration tools.

### Projects

Purpose: Manage project lifecycle.

Projects should support finding, creating, renaming, archiving, restoring, deleting, favoriting, and reviewing project status. Project cards should expose high-value status signals such as open actions, overdue work, schedule status, and next task.

Projects should remain the user's primary mental model. Location intelligence should support project identification in the background, not compete with Projects as a separate daily destination.

### Capture

Purpose: Document field work.

Capture should start a project update quickly, support photos, captions, project area, notes, recipients, and action items, and guide the user toward saving or sending the update.

Capture should prefill project, area, building, zone, date, time, user, weather, and current schedule activity whenever that context can be determined.

### Reports

Purpose: Communicate project status.

Reports should provide clear paths to executive reports, weekly reports, project health, schedule status, photo logs, open issues, critical path, milestones, and saved update history.

### More

Purpose: Admin, diagnostics, sync, settings, and developer tools.

More should contain tools that are useful but not part of the daily field workflow, including diagnostics, sync now, test connection, cloud status, backup/restore, settings, build info, and developer tools.

## 10. Project Card Standard

Every project card should answer five questions immediately:

1. What project is this?
2. Is it healthy?
3. What needs attention?
4. What happens next?
5. How do I update it?

Project cards should prioritize:

- Project Name
- Health Status
- Progress
- Schedule Status
- Open Issues
- Next Milestone

Administrative actions should not dominate the card.

Primary Action:

- Update

Secondary actions should be placed inside an overflow menu:

- Rename
- Favorite
- Archive
- Delete
- Duplicate
- Export

## 11. 60-Second Workflow Standards

### Capture Update

Target:

- Open app
- Tap Capture
- Select or confirm project
- Add photo or note
- Save or send update

Standard:

- Starting capture must be possible in two taps or fewer.
- Project, area, building, zone, date, time, user, weather, and current schedule activity should be prefilled when available.
- The user should never need to visit admin or settings to capture a normal update.

### Create Project

Target:

- Open Projects
- Tap Add Project
- Enter project name
- Save

Standard:

- Project creation should be possible in under 30 seconds.
- Creating a project must not require cloud connectivity.

### Find Project

Target:

- Open Projects
- Search, filter, or select from recent/favorite projects
- Open project action

Standard:

- A project manager should be able to find an active project in under 15 seconds.
- Search and filters must remain visible and readable.

### Generate Report

Target:

- Open Reports
- Select report type
- Review generated report
- Share or copy if available

Standard:

- Report generation should start from a clear report card.
- Reports must prioritize decisions, risks, completed work, and communication.

### Sync Cloud Data

Target:

- Open More
- Tap Sync Now
- Review result

Standard:

- Sync belongs in More/Admin, not on daily-use screens.
- Sync status should be understandable without exposing API keys.

### Run AI Analysis

Target:

- Open AI Coach or Executive Brief
- Review local deterministic analysis
- Tap Analyze with AI only when external AI analysis is desired

Standard:

- Local analysis should always be available.
- External AI calls must be explicit.

### Review Project Status

Target:

- Open Home or Projects
- Review attention items, schedule status, recent updates, and project health signals
- Open report or project if more detail is needed

Standard:

- Status should be understandable from summary cards before the user drills into raw data.

## 12. Screen Design Standards

- Use one primary action per screen.
- Do not hide daily-use features more than two levels deep.
- Use large readable buttons.
- Use large touch targets.
- Design for outdoor readability.
- Reduce decisions by using intelligent defaults and inferred context.
- Do not place admin or debug clutter on daily-use screens.
- Do not add a feature only because it is possible.
- Prefer useful project context over decorative UI.
- Keep screen titles clear and literal.
- Keep workflows direct enough for a tired project manager in the field.
- Keep location selection in the background whenever practical.

## 13. Button Standards

- Buttons must use clear labels.
- Button text must use a large readable font.
- Buttons must provide a comfortable minimum touch area.
- Primary actions should be visually obvious.
- Secondary actions should remain visible but not compete with the primary action.
- Destructive actions must be red.
- Destructive actions require confirmation.
- Icon-only buttons require clear accessibility labels.
- Button text must not truncate in normal iPhone screen sizes.

## 14. AI Standards

AI should:

- Summarize project status
- Identify risks
- Identify action items
- Support executive and customer communication
- Help project managers see what changed and what matters
- Use available context such as project, location, area, schedule activity, weather, and recent history
- Explain recommendations in project-management language
- Never replace project manager judgment

AI should not:

- Hide uncertainty
- Invent project facts
- Send data externally without a deliberate user action
- Replace the project manager's responsibility to verify information

## 15. Reporting Standards

Reports should answer:

- What is complete?
- What is behind?
- What changed?
- What needs attention?
- What decision is needed?
- What should be communicated to bosses or customers?

Reports should prioritize:

- Executive summary
- Completed work
- Open issues
- Overdue work
- Schedule risk
- Critical path concerns
- Upcoming milestones
- Customer-ready communication

## 16. Schedule Standards

Uploaded schedules must produce visible value.

Schedule features should surface:

- Upcoming tasks
- Overdue tasks
- Milestones
- Critical path items
- Risks
- Project schedule health
- Tasks by project
- Tasks by area
- Tasks with missing project or area mapping

After a schedule upload, the user should see:

- A success message
- Number of items imported
- Number of milestones identified
- Number of overdue tasks
- Number of upcoming tasks in the next 7, 14, and 30 days
- A clear path to Schedule Summary

If parsing is limited, the app should still create visible imported schedule items so the user can review and correct them.

## 17. Future Development Rule

Before implementing a new feature, check whether it supports the product mission and the 60-second rule.

Ask:

- Does this reduce time to understand, communicate, or decide?
- Does this support a primary user workflow?
- Can the workflow be completed in under 60 seconds?
- Does this reduce decisions for the user?
- Can the app infer or remember this context automatically?
- Is this useful to a Field Technician, Project Manager, Executive, or Customer?
- Does this belong on a daily-use screen or in More/Admin?
- Is this a project workflow, or should location remain background intelligence?
- Does this preserve existing functionality while simplifying access?

If the answer is unclear, write the user value first before writing code.
