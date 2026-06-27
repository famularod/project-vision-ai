# Project Vision AI Test System

## Purpose

The Project Vision AI testing system exists to create a repeatable diagnostic layer for the app.

The long-term goal is a JARVIS-style assistant that can inspect the application, run workflows, detect broken navigation, catch visual problems, measure 60-second workflows, and confirm that new work still follows the Project Vision AI Design Standard.

The first version should focus on structure, repeatability, and low-risk automation. It should not require broad app rewrites before it becomes useful.

## Testing Philosophy

- Test the product mission, not only code execution.
- Protect the 60-second workflow rule.
- Prefer workflow tests over isolated implementation details for daily-use screens.
- Keep tests readable enough that a project manager can understand what behavior is protected.
- Treat accessibility labels, stable button text, and clear screen titles as testable product contracts.
- Add automation gradually without blocking useful manual testing.
- Do not add test tooling that makes normal Expo development harder.

## Test Layers

### 1. Code Health Tests

Purpose:

- Confirm TypeScript correctness.
- Catch import, type, and contract errors before runtime.
- Provide a fast default diagnostic check.

Current command:

```bash
npm run check
```

Initial automated test command:

```bash
npm run test:check
```

Expected coverage:

- TypeScript compile health
- Safe imports
- Basic app structure integrity

### 2. Component Tests

Purpose:

- Test individual React Native components in isolation.
- Confirm buttons, labels, empty states, and conditional sections render correctly.
- Validate product rules such as visible primary actions and readable placeholder states.

Recommended future tools:

- Jest
- React Native Testing Library

Good first component targets:

- Home dashboard cards
- Project card rows
- Project Overview summary sections
- Reports Hub cards
- Schedule summary cards
- AI recommendation/result cards

### 3. End-to-End Workflow Tests

Purpose:

- Confirm users can complete important workflows through real navigation.
- Catch broken bottom navigation, missing screens, and regressions across state transitions.
- Measure tap count and path simplicity.

Recommended first E2E tool:

- Maestro

Initial workflows:

- Open app and start Capture Update in two taps or fewer.
- Open Projects and land on Project Overview.
- Open Reports from bottom navigation.
- Open More/Admin and reach diagnostics/sync tools.
- Upload a schedule and view the schedule summary.
- Generate an executive report path.

### 4. Visual Checks

Purpose:

- Catch layout, clipping, overflow, unreadable text, and tiny touch targets.
- Confirm screens remain usable on common iPhone sizes.
- Confirm bottom navigation remains stable.

Recommended checks:

- Screenshot capture for key screens.
- Manual or automated comparison against approved baselines.
- Button text overflow checks.
- Minimum touch target checks.
- Outdoor readability review for contrast and font size.

Future tools:

- Maestro screenshots
- Detox screenshots
- Custom screenshot review scripts
- Optional visual diff service if the project later needs CI image comparison

### 5. Product Standard Checks

Purpose:

- Confirm features support the Design Standard.
- Prevent admin/debug clutter from returning to daily-use screens.
- Confirm daily workflows are not hidden too deeply.

Checks should answer:

- Does the screen support capture, insight, decisions, or communication?
- Is there one clear primary action?
- Are daily-use controls no more than two levels deep?
- Are admin tools contained in More/Admin?
- Are destructive actions red and confirmed?
- Are project cards focused on health, schedule, issues, next milestone, and update?
- Does the app reduce decisions through defaults or inferred context?

### 6. 60-Second Workflow Checks

Purpose:

- Confirm primary workflows remain fast enough for field use.
- Track tap counts, screen transitions, and unnecessary decisions.

Target workflows:

- Capture update
- Create project
- Find project
- Generate report
- Sync cloud data
- Run AI analysis
- Review project status

Suggested metrics:

- Tap count
- Screen count
- Time to first meaningful action
- Time to save or generate output
- Number of required manual choices

Automation target:

- Maestro should eventually run timed workflows and fail when a workflow exceeds the approved tap or time threshold.

## Recommended Tools

### Jest

Best for:

- Unit tests
- Pure utility functions
- Small rendering tests when paired with React Native Testing Library

Pros:

- Fast
- Standard JavaScript testing foundation
- Strong fit for utility functions such as schedule summaries and report transforms

Cons:

- Not currently installed
- Does not test real native navigation or device behavior by itself

Recommendation:

- Add later when component and utility test coverage begins.

### React Native Testing Library

Best for:

- Component behavior
- User-facing text and button checks
- Empty states and conditional rendering

Pros:

- Encourages testing visible behavior instead of implementation details
- Good fit for Project Overview, Reports Hub, cards, and forms

Cons:

- Requires Jest setup
- May need additional mocks for Expo modules

Recommendation:

- Add after the first E2E workflow coverage is defined, or alongside Jest when component contracts need protection.

### Maestro

Best for:

- Mobile E2E workflows
- Tap-based navigation tests
- Screenshots
- Smoke tests on Expo/dev builds

Pros:

- Lower setup burden than Detox
- YAML workflows are readable
- Strong fit for 60-second workflow checks
- Good first automation layer for navigation and UX validation

Cons:

- Less granular than component tests
- Requires a running app on simulator, emulator, or device

Recommendation:

- Best first new testing tool for Project Vision AI.

Reason:

- The biggest product risk right now is workflow quality: navigation, screen clarity, tap count, and visible outputs. Maestro can test those risks with less app restructuring than Detox and without waiting for a full Jest/RNTL setup.

### Detox

Best for:

- Deep React Native E2E testing
- Native-device confidence
- More advanced synchronization and app control

Pros:

- Powerful mobile automation
- Strong for mature CI pipelines

Cons:

- Heavier setup
- More native configuration
- Higher maintenance cost for an early Expo app

Recommendation:

- Add later if Maestro is not enough or if the project needs deeper native test control.

## Best First Tool

Recommended first tool:

- Maestro

Why:

- Project Vision AI's highest-priority risks are workflow and UX risks, not isolated algorithm risks.
- Maestro can validate bottom navigation, project-opening behavior, report hub routing, capture-start speed, schedule upload visibility, and 60-second workflows.
- It can start as a smoke-test layer without changing app behavior.

Keep using immediately:

- `npm run check`
- `npm run test:check`

Add later:

- Jest and React Native Testing Library for component and utility tests.
- Detox only when the app needs deeper native automation.

## Future Roadmap

### Phase 1: Foundation

- Create this testing system document.
- Create the manual test plan.
- Add safe package script aliases for code health.
- Keep app behavior unchanged.

### Phase 2: First Automation

- Add Maestro.
- Create smoke tests for bottom navigation.
- Create 60-second workflow tests for Capture Update, Reports, and Project Overview.
- Capture screenshots for Home, Projects, Project Overview, Capture, Reports, and More/Admin.

### Phase 3: Component Coverage

- Add Jest.
- Add React Native Testing Library.
- Test reusable cards, project rows, report cards, schedule summary sections, and empty states.
- Add tests for destructive-action confirmations.

### Phase 4: Product Standard Diagnostics

- Add automated checks for screen titles, primary actions, button labels, and admin tool placement.
- Add tap-count and route-depth checks for daily workflows.
- Add visual review baselines for common iPhone sizes.

### Phase 5: JARVIS-Style Diagnostic Assistant

- Run test workflows from a single diagnostic command.
- Summarize failures in plain project-management language.
- Recommend likely affected screens and product standards.
- Produce a release-readiness report before each sprint handoff.
