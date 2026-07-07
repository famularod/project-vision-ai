# PIE Product Operating Plan

## Purpose

This is the controlling product operating plan for Project Vision AI.

Project Vision AI is the first application of ECOS, the Executive Cognitive Operating System.

ECOS provides the domain-independent Cognitive Framework. PIE is the first Domain Intelligence Engine inside ECOS and applies that framework to project intelligence.

The ECOS Domain Adapter keeps generic cognition separate from project-specific interpretation.

PIE, the App, and the User must operate as one simple ecosystem:

```text
User -> App Evidence Capture -> PIE Processing -> App Output -> User Approval
```

The product exists to reduce user effort, improve project understanding, and make the next project action clear.

Operating ownership:

- ECOS Cognitive Framework owns reusable cognitive abilities across domains.
- ECOS Domain Adapter owns translation between domain-specific evidence and ECOS generic cognitive input/output.
- PIE owns understanding.
- PIE Core Intelligence owns project-specific translation of review, interpretation, analysis, belief, opinion, decision, recommendation, explanation, reflection, and learning.
- Experience Engine owns attention and user flow.
- App owns interaction and display.

Future UI should render experience state, not raw engine outputs.

## 1. Product Model

Project Vision AI is not a feature collection. It is an evidence-to-understanding loop.

1. User provides field evidence quickly.
2. App captures evidence with minimal friction.
3. PIE processes evidence into project understanding.
4. App presents PIE output clearly.
5. User confirms, corrects, approves, or communicates the final output.

Operating model:

```text
Photo + GPS + Schedule + Documents + Notes
  -> Evidence Quality
  -> Missing Evidence
  -> Evidence Timeline
  -> Evidence Fusion
  -> Reality Model
  -> Knowledge Graph
  -> Reflection
  -> Beliefs
  -> Mission
  -> Attention
  -> Experience Engine
  -> Reporter
  -> User Summary
```

## 2. PIE Responsibilities

PIE is responsible for project understanding.

Before PIE forms beliefs or recommendations, it should judge evidence quality. Recent, project-tied, area-tied, GPS-confirmed, photo-supported, schedule-supported, user-confirmed evidence should carry more weight than stale, incomplete, conflicting, unreviewed OCR, or previously corrected evidence.

Before PIE presents weak recommendations as certain, it should identify missing evidence and ask for the minimum evidence needed to reduce uncertainty.

PIE should understand evidence over time. It should know what changed, when it changed, whether progress is moving, and whether an area or issue is going stale.

PIE should maintain a Reality Model as its single current representation of project reality. Evidence updates the Reality Model. Judgment, prediction, reporting, attention, and experience read from the Reality Model.

Reality Objects should become intelligent project objects. Each object should know its goals, relationships, dependencies, confidence, readiness, risk level, momentum, next best action, uncertainty, and whether an owner is needed.

Situation Intelligence should summarize Reality Model and Object Intelligence into the current project situation. It should identify what is happening, what changed, what matters, what is blocked, what is ready, what needs verification, and why the user is likely working. PIE should use that current situation to guide Attention, Experience, Executive Reasoning, Predictive Simulation, and Reporter.

Predictive Reality should project how project reality may evolve next. It should identify future object states, readiness forecasts, cascading effects, no-action risk, recovery opportunity, and the evidence needed to rely on the forecast. The App should not expose forecast internals; it should show what PIE expects, why it matters, and what evidence can change the forecast.

PIE must:

- Greet the user in useful project-manager language.
- Know where the user most likely is when field context is available.
- Process photos, GPS, documents, schedules, typed notes, and talk-to-text notes.
- Connect all evidence into a complete project understanding.
- Summarize the big picture.
- Explain details when needed.
- Identify critical items.
- Generate David-style reports with supporting photos.

PIE should recommend, explain, and prepare. It should not approve, send, close, or commit important project decisions without user review.

## 3. App Responsibilities

The App is the fast capture and clear presentation layer.

The App must provide:

- Fast evidence capture.
- Clean Apple-like UI.
- Minimal choices.
- Photo capture.
- GPS capture.
- Document upload.
- Typed and talk-to-text input.
- Clear display of PIE outputs.
- Hidden technical and admin complexity.

The App should not become the intelligence source. It should collect evidence for PIE and display PIE output in clear, reviewable language.

## PIE Core Intelligence Rule

PIE is the reusable intelligence brain.

PIE now sits inside ECOS as the first Domain Intelligence Engine. The Cognitive Framework defines reusable thinking. PIE translates that thinking into project-specific understanding and output.

The adapter flow is:

```text
PIE data -> PIEDomainAdapter -> ECOS Cognitive Framework -> PIEDomainAdapter -> PIECoreIntelligence output
```

Rule:

- If a capability is domain-independent, it belongs to ECOS Cognitive Framework.
- If a capability translates between project evidence and ECOS cognition, it belongs to PIEDomainAdapter.
- If it is project-specific, it belongs to PIE.

The current app is one application of PIE, not the owner of PIE intelligence. Apps collect input and display PIE output. PIE owns review, interpretation, analysis, belief, opinion, decision, recommendation, explanation, reflection, and learning.

PIE Core Intelligence should remain reusable across future domains:

- maintenance
- manufacturing
- safety
- compliance
- operations
- facilities
- logistics

Feature code should not bury intelligence inside app-specific screens or workflows. New intelligence should strengthen the reusable PIE Core pattern first, then surface through App output.

PIE uses past experience to interpret new evidence. Memory Recall should compare new inputs against past events, updates, photos, schedules, recommendations, reports, corrections, Reflection lessons, and prior Core beliefs or opinions before PIE forms new interpretations, recommendations, or explanations.

Memory Recall is a PIE capability, not a normal user workflow. The App should display the resulting clarity only when it improves output, attention, recommendations, or review confidence.

PIE Cognitive Abilities:

- Observation
- Understanding
- Memory
- Reflection
- Causal Reasoning
- Self-Challenge
- Trade-Off Analysis
- Constraint Awareness
- Decision Scoring
- Goal Awareness
- Scenario Simulation
- Strategic Memory
- Meta-Cognition
- Deliberation

PIE should not recommend important actions without deliberating. Before important recommendations reach the App, PIE should review assumptions, contradictions, missing evidence, alternatives, trade-offs, readiness, and what would change the recommendation.

## 4. User Responsibilities

The User remains responsible for decisions and communication.

The User should:

- Provide evidence quickly.
- Confirm or correct PIE.
- Approve reports.
- Communicate final outputs.

User actions are intentionally limited to:

- Confirm
- Capture
- Correct
- Approve
- Communicate

## 5. UI Principles

The interface must reduce effort instead of exposing internal complexity.

Product surfaces should follow these rules:

- One primary action.
- No technical clutter.
- No raw diagnostics in normal workflows.
- No unnecessary options.
- PIE recommends, user verifies.
- Advanced tools stay hidden unless the user is in an advanced support path.
- Future UI renders Experience Engine state instead of raw PIE engine output.

Normal users should see project status, evidence capture, recommendations, and reviewable outputs. Developer diagnostics, raw sync details, connection tests, and debug data belong only in advanced support areas.

## Walk Operating Rule

Walk is a guided evidence-collection state.

Walk should not feel like a form. PIE should ask for the evidence it needs, the user should capture or correct that evidence, and the Experience Engine should decide the next Walk action.

Walk flow:

1. PIE recommends the project and area.
2. User accepts or corrects location.
3. PIE asks for the next useful evidence item.
4. User captures a photo, adds a note, or corrects context.
5. Experience Engine decides whether to continue, finish, or review the Walk update.

## Review Operating Rule

Review is an approval state, not a report menu.

PIE prepares communication, but the user reviews, edits, approves, and communicates the final output. Experience Engine decides the next Review action based on report readiness, review warnings, action items, image references, confidence, missing evidence, schedule status, photo progress, and selected combined-update evidence.

Review flow:

1. PIE prepares a David-style report draft.
2. Experience Engine explains whether the report is ready or needs review.
3. User reviews warnings, edits content, or approves the report.
4. Copy and Email actions remain approval-bound.
5. No report is sent automatically.

## Reflection Operating Rule

Reflection Layer:

Reflection is PIE's continuous learning layer.

Continuous Learning:

Reflection does not analyze the project directly. It evaluates whether PIE's understanding became stronger or weaker after new evidence arrives.

Reflection Events:

Reflection events:

- schedule import
- accepted photo
- accepted note
- GPS correction
- project correction
- area correction
- report approval
- walk completion
- daily reflection

Reflection Responsibilities:

Reflection responsibilities:

- Explain what changed.
- Compare new evidence to previous PIE beliefs.
- Identify whether beliefs were strengthened, weakened, unchanged, or corrected.
- Identify whether PIE was wrong or correct.
- Identify what still needs verification.
- Recommend what evidence PIE should collect next.
- Prepare updated beliefs and confidence changes for Runtime, Experience, and Reporter.

Reflection should make PIE better over time without bypassing the user. When Reflection weakens a belief, Experience should prioritize verification. When Reflection identifies missing evidence, Experience should recommend collecting it. Reporter should use Reflection only to improve confidence wording, action recommendations, project narrative quality, and review warnings; Reflection should not be pasted directly into user reports.

## 6. Evidence Flow

All project intelligence should flow through the same understanding path:

```text
Photo + GPS + Schedule + Documents + Notes
  -> Evidence Quality
  -> Missing Evidence
  -> Evidence Timeline
  -> Evidence Fusion
  -> Reality Model
  -> Knowledge Graph
  -> Reflection
  -> Beliefs
  -> Mission
  -> Attention
  -> Experience Engine
  -> Reporter
  -> User Summary
```

Evidence Fusion turns separate field inputs into one honest view of the project. The Reality Model maintains PIE's single current representation of project reality. The Knowledge Graph connects evidence to areas, people, schedule items, issues, decisions, and risks. Reflection evaluates whether new evidence strengthens or weakens PIE's beliefs before those beliefs influence Mission, Attention, Experience, or Reporter. Mission and Attention decide what matters now. Experience Engine decides what the user should experience next. Reporter turns approved understanding into David-style communication. The User Summary makes project status clear enough to act on.

## 7. Output Requirements

Every PIE output must be understandable and reviewable.

Outputs must include:

- Clear project summary.
- Critical items highlighted.
- Obvious next action.
- David-style report when communication is needed.
- Supporting photos referenced.
- Status that the user can understand quickly.

PIE must never invent facts. Uncertain items should be marked for review.

## 8. Development Rules

This operating plan controls future product decisions unless a better idea is explicitly approved.

Development rules:

- Do not deviate from this plan unless a better idea is explicitly approved.
- Every sprint must improve PIE, evidence capture, or output clarity.
- Every feature must reduce user effort or improve project understanding.
- The App should hide technical/admin complexity from normal workflows.
- Outputs must remain clear, reviewable, and user-approved before communication.

JARVIS should use this plan as a release gate. A sprint that adds options, exposes technical clutter, or fails to improve PIE understanding, evidence capture, or output clarity should not pass without explicit approval.

## 9. Scientific Method Operating Rule

PIE thinks through the Scientific Method:

```text
Question -> Observe -> Collect Evidence -> Interpret -> Recall Similar Situations -> Generate Hypotheses -> Challenge Hypotheses -> Evaluate Alternatives -> Predict Outcomes -> Select Best Decision -> Explain -> Monitor Result -> Reflect -> Learn
```

PIE should not make important recommendations without evidence, hypothesis, self-challenge, uncertainty statement, and explanation.

The user experience should show the result simply:

- What PIE recommends.
- Why it matters.
- What evidence supports it.
- What is uncertain.
- What should be verified next.

The App should not expose raw scientific reasoning as clutter. The App should display the clear recommendation, review warning, confidence, and next action.

Scientific Method supports the product model:

```text
User -> App Evidence Capture -> PIE Scientific Method -> PIE Processing -> App Output -> User Approval
```

This keeps decision quality above information quantity.
