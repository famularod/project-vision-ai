# PIE Memory Recall Model

## Purpose

PIE Memory Recall gives PIE the ability to pull from past experiences, past thoughts, past project information, and prior reflections when interpreting new evidence.

PIE should not treat every new input as isolated. Before forming a new interpretation, belief, opinion, recommendation, explanation, report, attention item, or experience state, PIE should ask whether similar evidence has appeared before.

## Memory Sources

Memory Recall can use:

- past project events
- past updates
- past photos
- past schedule items
- past recommendations
- past report drafts and report history when available
- past user corrections
- past reflection lessons
- past beliefs and opinions from PIE Core Intelligence when available

Each recalled memory should include source, date or time when available, project, area, summary, relevance reason, confidence, and how it should influence interpretation.

## Relevance Rules

Memory is relevant when it shares one or more of:

- same project
- same area
- similar evidence language
- similar schedule task or status
- similar action owner or open action
- similar safety or issue language
- prior recommendation about the same condition
- prior user correction about the same project, area, GPS boundary, report, or recommendation
- prior Reflection lesson that applies to the new evidence

Memory Recall should prefer concise, high-signal history. It should not overwhelm PIE or the user with every past record.

QA markers: Memory Recall supports recurring pattern detection, user correction learning, and a reflection-to-memory loop so PIE can interpret new information with past experience.

## Comparisons

Memory Recall helps PIE answer:

- Have we seen this before?
- Is this recurring?
- Is this different from last time?
- Did a previous recommendation work?
- Did the user correct PIE on something similar?
- Does this match or contradict past evidence?
- What happened the last time this condition existed?
- What should PIE be careful about based on history?

## Recurring Pattern Detection

Recurring patterns are detected when multiple relevant memories point to similar project, area, task, issue, safety, photo, correction, or recommendation context.

Examples:

- Electrical was reported incomplete in the same area several days apart.
- A user repeatedly corrected the same GPS area recommendation.
- A schedule item remains waiting across multiple updates.
- A safety concern appears in both photos and notes.

Recurring patterns should influence interpretation, attention, recommendations, and report context.

## User Correction Learning

User corrections are high-value memory.

If the user corrects PIE on project, area, GPS, report wording, recommendation, or evidence interpretation, future similar cases should lower confidence and ask for verification before action.

Example:

```text
User changed area from Canopy B to Canopy C twice.
Future GPS recommendations near that boundary should ask for verification before assuming Canopy B.
```

## Reflection-To-Memory Loop

Reflection creates lessons that Memory Recall can use later.

Reflection should produce:

- lessons learned
- incorrect assumptions
- corrected recommendations
- confidence adjustments
- future caution notes

Memory Recall should retrieve those lessons when similar evidence appears again.

## Interpretation Improvements

Memory improves interpretation by adding history:

```text
New evidence: Electrical still not complete.
Memory Recall: Electrical was also reported incomplete in this area three days ago.
Interpretation: This may indicate loss of momentum.
```

PIE should distinguish between new information, repeated information, contradicted information, and resolved information.

## Recommendation Improvements

Memory improves recommendations by preventing repeated weak advice.

If a previous recommendation did not resolve the condition, PIE should recommend verification, escalation, or a different next action instead of repeating the same suggestion.

If the user previously corrected PIE, Memory Recall should lower confidence and ask for confirmation.

## Reporter Improvements

Reporter should use memory sparingly.

Useful memory context:

- This issue has been noted in prior updates.
- This remains open from the previous walk.
- Progress appears to have resumed after last week's delay.

Reporter should not overuse history or paste raw memory. Past context belongs in the report only when it improves clarity.

## Experience And Attention Improvements

Memory should influence what PIE asks the user to verify.

- Recurring issue: higher attention.
- Previously corrected GPS area: lower confidence.
- Past open action item: remains attention-worthy.
- Repeated incomplete work: ask for current evidence.

## Future Long-Term Memory Path

Current Memory Recall can operate from local Runtime, project events, updates, schedules, photos, report history, Reflection lessons, and Core Intelligence output.

Future long-term memory should add durable storage only after recall relevance, confidence, correction behavior, and user review boundaries are proven.
