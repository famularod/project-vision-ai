# PIE Experience State Machine

PIE-guided experience should be modeled as state, not scattered page behavior.

## States

### Observe

PIE collects current Runtime, Mission, Executive, Schedule, Evidence Fusion, Photo Progress, GPS, issue, safety, and report-readiness signals.

### Attend

PIE selects the single item that deserves attention now.

### Explain

PIE explains why this item matters in project-manager language.

### Recommend

PIE recommends one next step and one user action type:

- Confirm
- Capture
- Correct
- Approve
- Communicate

### Act

The user chooses the primary action, uses a secondary action if available, or continues through normal navigation.

### Learn

Future phases should let user corrections and approvals improve future recommendations.

## Transition Rules

- Observe -> Attend when Runtime has usable project context.
- Attend -> Explain when PIE can state a reason.
- Explain -> Recommend when a next step is available.
- Recommend -> Act only through user choice.
- Act -> Learn only after user correction, approval, capture, or communication.

PIE must not skip user approval for communication, safety, schedule, or stakeholder-impacting actions.
