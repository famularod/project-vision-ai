# PIE Reflection Model

## Purpose

PIE Reflection is PIE's self-audit layer.

Reflection helps PIE ask:

- How good is my understanding?
- What evidence supports my conclusions?
- What evidence is missing?
- Which recommendations are weak?
- Where could I be wrong?
- What should the user verify first?

Reflection exists to make PIE more trustworthy before its intelligence reaches the user.

## What PIE Reflection Is

PIE Reflection audits PIE's own thinking.

It reviews Runtime, Executive, Decision, Reasoning, Memory, Knowledge Graph, Events, and Intelligence output and looks for weak support, missing evidence, stale information, contradiction, and overconfident recommendations.

Reflection should help PIE reduce uncertainty by identifying the next verification that would most improve confidence.

## What PIE Reflection Is Not

PIE Reflection is not a chatbot.

PIE Reflection is not a project decision maker.

PIE Reflection does not override Runtime, Executive, Decision, or user approval.

PIE Reflection does not invent facts, close issues, approve decisions, change project status, send reports, or communicate with stakeholders.

PIE Reflection audits the quality of PIE's thinking so the user can trust, verify, correct, or approve with better context.

## How Reflection Makes PIE More Trustworthy

Reflection improves trust by checking whether PIE's conclusions are supported by current, relevant, non-conflicting evidence.

It should:

- Identify recommendations with little or no evidence.
- Identify recommendations with low confidence.
- Identify high-priority decisions with weak support.
- Find stale updates that could weaken project status conclusions.
- Find missing photos, schedule support, inspection status, documents, owners, and relationships.
- Surface contradiction instead of hiding it.
- Suggest where confidence should be reduced.
- Tell the user what to verify first.

## Reflection Questions

PIE Reflection should regularly ask:

- What am I assuming?
- What evidence supports that assumption?
- What evidence contradicts it?
- Is the evidence current?
- Is this recommendation stronger than the evidence allows?
- Is a high-priority action missing enough support?
- Is there a missing inspection, schedule, photo, or document signal?
- What question would most improve project understanding?

## Weak Recommendation Detection

A weak recommendation is a recommendation that may be useful but does not yet have enough support.

Reflection should flag a recommendation when:

- It has no evidence.
- It has only one evidence item.
- It has low confidence.
- It is high or critical priority but has weak support.
- It depends on inspection status that is missing.
- It depends on schedule status without schedule evidence.
- It depends on project status when updates are stale.

Weak recommendations should not disappear. They should become verification prompts or lower-confidence recommendations.

## Evidence Audit

The Evidence Audit reviews how well PIE's conclusions are supported.

It should report:

- Total evidence count.
- Fresh evidence count.
- Stale evidence count.
- Strongest evidence.
- Weakest evidence.
- Missing evidence.
- Contradictions.
- Recommendation support.

Evidence audit output should feed trust, explainability, and future Project Assistant answers.

## Confidence Audit

The Confidence Audit compares PIE's stated confidence against available support.

It should identify:

- Runtime confidence that is too high for the evidence.
- Beliefs with contradiction or no support.
- Recommendations that should be reduced from high to medium or low.
- High-risk decisions where confidence should be lowered until verified.

Confidence adjustments are suggestions, not automatic truth changes. Runtime or future Behavior can use them to communicate uncertainty more clearly.

## Verification Questions

Reflection produces verification questions when answering them would materially improve PIE's understanding.

Examples:

- What is the current inspection status?
- Do we have current photos that confirm this project status?
- Is the current schedule imported or updated?
- What changed since the last saved update?
- What evidence confirms this recommendation?
- What project record connects this recommendation to evidence?

Reflection should ask questions only when the answer improves project understanding, risk handling, communication readiness, or decision confidence.

## System Connections

### Runtime

Runtime is PIE's UI-facing contract. Reflection can audit Runtime beliefs, recommendations, Trust Score, Understanding Score, Preparedness Score, graph-backed evidence, and Executive-backed priorities.

Future Runtime integration should expose Reflection output as:

- Weak recommendations.
- Verification questions.
- Confidence adjustments.
- Missing evidence.
- What PIE should verify first.

### Executive

Executive decides what deserves management attention. Reflection checks whether Executive priorities and preparations have enough evidence, confidence, urgency, impact, and approval boundaries.

### Knowledge Graph

Knowledge Graph provides relationship-backed evidence, graph gaps, blocked items, contradictions, and connected evidence. Reflection uses those relationships to audit whether recommendations are explainable.

### Decision

Decision Engine prioritizes actions. Reflection checks whether high-priority decisions have enough support and whether approval-required items remain under user control.

### Reasoning

Reasoning produces facts, concerns, questions, thoughts, and recommendations. Reflection audits whether those thoughts are evidence-backed and whether questions should become user verification prompts.

### Memory

Memory provides project story, history, patterns, and gaps. Reflection uses Memory to detect stale updates, missing history, repeated missing context, and weak project-story support.

### Conversation

Conversation turns PIE output into user-facing language. Reflection can help Conversation avoid overstating certainty and can provide concise explanations of what PIE is unsure about.

### JARVIS

JARVIS validates that Reflection identifies weak recommendations, missing evidence, verification questions, confidence reduction, and approval-boundary preservation.

## Future Path For AI-Assisted Reflection

Phase 1 is local and rule-based.

Future AI-assisted reflection can help summarize uncertainty and compare broader evidence patterns, but only after deterministic Reflection is reliable.

AI-assisted Reflection must:

- Use existing evidence.
- Never invent project facts.
- Preserve user approval.
- Explain uncertainty.
- Produce reviewable outputs.
- Remain subordinate to Runtime, Executive, and user approval boundaries.
