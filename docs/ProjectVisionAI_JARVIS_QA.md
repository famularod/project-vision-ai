# Vitruvius Intelligence Center (V.I.C.) QA

## Purpose

V.I.C. is the internal quality system for Vitruvius Project Intelligence.

Its purpose is to protect the product experience before every release by checking layout, navigation, critical workflows, project intelligence, and release readiness. V.I.C. should make it harder for broken text, clipped buttons, confusing navigation, or weak intelligence output to reach a field build.

V.I.C. does not replace human review. It gives the team a repeatable checklist and automation path so humans can review the product faster and with better confidence. Legacy source files and npm commands retain the JARVIS name until they can be migrated without breaking release automation.

## JARVIS Experience QA 2.0

JARVIS now acts as a complete product reviewer, not only a technical checker. The controlling standard is `docs/PIE_JARVIS_ExperienceQA.md`.

Every run scores these categories:

- Technical.
- Visual.
- UX.
- Executive.
- Cognitive.
- Experience.
- Apple HIG.
- Overall.

Build status is:

- PASS: no failures or warnings.
- PASS WITH WARNINGS: warnings remain, but no blocking failures were detected.
- FAIL: one or more blocking failures were detected.

JARVIS must actively try to reject weak builds. A build can fail even when TypeScript passes if the product experience is confusing, visually weak, too technical, missing executive-quality output, or violates the Experience Constitution.

Every run must include:

- Category scores.
- Top 10 rejection report.
- Problem, why it matters, suggested correction, and owner for each rejection item.
- Apple Review Notes.
- The self-challenge question: "If Apple reviewed this build tomorrow, what would they reject?"

## ECOS Cognitive Framework QA

JARVIS must verify the ECOS Cognitive Framework boundary.

Required:

- `docs/ECOS_CognitiveFramework.md` exists.
- `services/ECOSCognitiveFramework.ts` exists.
- ECOS = Executive Cognitive Operating System.
- Cognitive Framework = reusable thinking layer.
- PIE = project-specific intelligence engine using the framework.
- PIE as first domain engine is documented.
- ECOS, Cognitive Framework, Domain Intelligence Engine, PIE, and App responsibilities are separated.
- Apps collect input and display PIE output.
- If a capability is domain-independent, it belongs to ECOS Cognitive Framework.
- If it is project-specific, it belongs to PIE.
- Framework output includes observations, evidenceReview, interpretations, memoryRecall, patterns, hypotheses, challenges, beliefs, deliberation, predictions, decisionScores, recommendations, explanations, reflection, learning, uncertainty, readiness, and nextBestActions.
- ECOS Cognitive Framework avoids project-specific hardcoding.
- PIECoreIntelligence consumes `runECOSCognitiveFramework`.

## ECOS Domain Adapter QA

JARVIS must verify the adapter boundary between ECOS and domain engines.

Required:

- `services/ECOSDomainAdapter.ts` exists.
- `services/PIEDomainAdapter.ts` exists.
- `docs/ECOS_DomainAdapterModel.md` exists.
- ECOSDomain includes project, manufacturing, maintenance, safety, compliance, facilities, and logistics.
- Domain input/output types exist: ECOSDomainInput, ECOSDomainOutput, ECOSDomainEvidence, ECOSDomainContext, ECOSDomainGoal, ECOSDomainRisk, ECOSDomainConstraint, ECOSDomainDecision, ECOSDomainRecommendation, and ECOSDomainMappingResult.
- Generic adapter functions exist: buildECOSDomainInput, mapDomainEvidenceToECOS, mapDomainGoalsToECOS, mapDomainConstraintsToECOS, mapECOSOutputToDomain, mapECOSRecommendationToDomain, buildDomainRecommendation, and explainDomainMapping.
- PIE adapter helpers exist: buildPIEDomainInput, mapPIEEvidenceToECOS, mapPIEGoalsToECOS, mapPIEConstraintsToECOS, and mapECOSToPIEIntelligence.
- Project evidence maps to ECOS generic cognitive input.
- ECOS output maps back to project beliefs, project risks, project decisions, project recommendations, project uncertainty, project next best actions, and report insights.
- PIECoreIntelligence uses the adapter path: PIE data -> PIEDomainAdapter -> ECOS Cognitive Framework -> PIEDomainAdapter -> PIECoreIntelligence output.
- Architecture docs explain domain-neutral thinking versus domain-specific interpretation.
- Future domain engines use the same adapter pattern.

## PIE Evidence Quality QA

JARVIS must verify PIE Layer 1 Evidence Quality.

Required:

- `services/PIEEvidenceQuality.ts` exists.
- `docs/PIE_EvidenceQualityModel.md` exists.
- Quality types exist: PIEEvidenceQualityScore, PIEEvidenceQualityFactor, PIEEvidenceFreshness, PIEEvidenceReliability, PIEEvidenceCompleteness, PIEEvidenceRelevance, PIEEvidenceConflict, and PIEEvidenceQualityResult.
- Quality levels exist: strong, good, weak, stale, conflicting, and insufficient.
- Functions exist: evaluateEvidenceQuality, scoreEvidenceFreshness, scoreEvidenceCompleteness, scoreEvidenceReliability, scoreEvidenceRelevance, detectEvidenceConflicts, rankEvidenceByUsefulness, and summarizeEvidenceQuality.
- Evidence is stronger when recent, tied to project, tied to area, GPS confirmed, photo-supported, schedule-supported, user-confirmed, or matching prior evidence.
- Evidence is weaker when old, missing project, missing area, missing timestamp, missing supporting photo, contradicting newer evidence, from unreviewed OCR, or corrected by the user previously.
- PIECoreIntelligence exposes evidenceQuality, strongEvidence, weakEvidence, conflictingEvidence, staleEvidence, and evidenceReadiness.
- Belief Engine, Scientific Method, and Deliberation consume evidenceQuality where practical.
- Architecture docs place Evidence Quality under Layer 1 Perception.

## PIE Missing Evidence QA

JARVIS must verify PIE Layer 1 Missing Evidence.

Required:

- `services/PIEMissingEvidence.ts` exists.
- `docs/PIE_MissingEvidenceModel.md` exists.
- Missing Evidence types exist: PIEMissingEvidenceItem, PIEMissingEvidenceType, PIEMissingEvidenceImpact, PIEMissingEvidenceReason, PIEMissingEvidenceRequest, PIEMissingEvidencePriority, and PIEMissingEvidenceResult.
- Missing evidence types exist: missing_photo, missing_current_photo, missing_location, missing_schedule, missing_owner, missing_decision, missing_inspection_status, missing_safety_confirmation, missing_progress_note, missing_document, missing_report_review, and missing_user_confirmation.
- Functions exist: findMissingEvidence, prioritizeMissingEvidence, buildEvidenceRequests, identifyMinimumEvidenceNeeded, estimateUncertaintyReduction, and summarizeMissingEvidence.
- Missing Evidence answers what evidence is missing, why it matters, what decision it affects, the smallest evidence request that helps, and what the user should capture next.
- Missing Evidence can detect missing photos, schedules, owners, and decisions.
- PIECoreIntelligence exposes missingEvidence, highestImpactEvidenceGap, recommendedEvidenceRequests, and uncertaintyReductionActions.
- Attention and Experience can consume missingEvidence when a gap blocks a decision.
- Architecture docs place Missing Evidence under Layer 1 Perception.

## PIE Evidence Timeline QA

JARVIS must verify PIE Layer 1 Evidence Timeline.

Required:

- `services/PIEEvidenceTimeline.ts` exists.
- `docs/PIE_EvidenceTimelineModel.md` exists.
- Timeline types exist: PIEEvidenceTimeline, PIEEvidenceTimelineEvent, PIEEvidenceTimelineEventType, PIEEvidenceTimelineChange, PIEEvidenceTimelineGap, PIEEvidenceTimelineMomentum, and PIEEvidenceTimelineSummary.
- Timeline event types exist: photo_added, note_added, schedule_imported, schedule_changed, GPS_confirmed, user_corrected, issue_opened, issue_resolved, decision_needed, decision_made, report_generated, report_approved, and inspection_updated.
- Functions exist: buildEvidenceTimeline, groupTimelineByProject, groupTimelineByArea, detectTimelineGaps, detectStaleEvidence, detectProgressMomentum, summarizeTimelineChanges, and compareTimelinePeriods.
- Momentum detection covers progress_increasing, progress_slowing, no_recent_evidence, repeated_same_issue, area_going_stale, and new_activity_after_delay.
- PIECoreIntelligence exposes evidenceTimeline, timelineGaps, staleAreas, momentumSignals, and recentChanges.
- Pattern Engine and Belief Engine consume evidenceTimeline where practical.
- Architecture docs place Evidence Timeline under Layer 1 Perception.

## PIE Reality Model QA

JARVIS must verify PIE Layer 2 Reality Modeling.

Required:

- `services/PIERealityModel.ts` exists.
- `docs/PIE_RealityModel.md` exists.
- Reality Model types exist: PIERealityModel, PIERealityObject, PIERealityObjectType, PIERealityObjectIdentity, PIERealityObjectState, PIERealityObjectStatus, PIERealityEvidenceLink, PIERealityKnowledgeLink, PIERealityHistoryEvent, PIERealitySyncResult, and PIERealityModelSummary.
- Reality Model maintains an objectRegistry.
- Reality object types exist: project, building, area, work_package, schedule_activity, milestone, inspection, contractor, issue, risk, decision, document, photo, safety_observation, report, and owner_action.
- Reality object statuses exist: unknown, not_started, in_progress, ready, needs_verification, blocked, at_risk, contradicted, complete, and retired.
- Functions exist: buildPIERealityModel, createRealityObject, identifyRealityObjects, mergeRealityObjects, updateRealityObjectState, linkEvidenceToRealityObject, linkKnowledgeToRealityObject, appendRealityHistory, synchronizeRealityModel, and summarizeRealityModel.
- PIECoreIntelligence builds the Reality Model after Layer 1 perception outputs.
- PIECoreIntelligence exposes realityModel, realityModelSummary, realityObjects, realitySummary, objectsNeedingVerification, objectsAtRisk, objectsBlocked, objectsRecentlyUpdated, objectsReady, objectsUncertain, objectsWithHighRisk, objectNextActions, objectNextBestActions, and objectRelationshipSummary.
- Reality summary includes totalObjects, recentlyUpdatedObjects, objectsReady, objectsBlocked, objectsAtRisk, objectsNeedingVerification, strongestCurrentRealityStatement, weakestCurrentRealityAssumption, recommendedEvidenceToImproveModel, and confidence.
- Belief, Pattern, Prediction, Executive Reasoning, Reporter, Attention, and Experience can consume realityModel where practical.
- Architecture docs define Layer 2 = Reality Modeling.
- Docs state Reality Model is PIE's single current representation of project reality.
- Docs state evidence updates the Reality Model and judgment, prediction, reporting, attention, and experience read from the Reality Model.
- Docs state Reporter, Attention, Experience, Prediction, and Executive Reasoning should not rebuild raw context when Reality Model is available.
- Layer 2 can answer what the current project reality is, what changed recently, which objects matter, what is ready, what is blocked, what is uncertain, what supports the current goal, what is likely to happen next, and what evidence would improve the model.
- Durable Reality Model persistence exists in `PIERealityModelStorage`, `PIERealityModelRepository`, and `PIERealityModelSynchronization`.
- Reality Models are organization-scoped and project-scoped.
- Reality Models include model version, status, source evidence cutoff, model confidence, readiness, expected future state, conflicts, uncertainties, and change history.
- Reality Objects include stable object ID, organization ID, project ID, prior/current/expected state, source evidence references, assertions, relationships, dependencies, readiness, risk, uncertainty, confidence, next best action, and history.
- Assertions are classified as fact, assumption, inference, or prediction.
- Facts require supporting evidence.
- Inferences require explanation.
- Predictions require assumptions or an expected timeframe.
- Conflicting evidence is preserved as explicit conflict records.
- Missing/stale/weak/ambiguous evidence is preserved as uncertainty records.
- Local storage is organization/project scoped and snapshots are immutable from caller mutation.
- Supabase schema includes Reality Models, Objects, Assertions, Relationships, Object History, Model Snapshots, Conflicts, and Uncertainties.
- Reality Model database tables use organization/project IDs, non-permissive RLS, and append-only history/snapshot guards.
- Core accepts an authoritative Reality Model and exposes `realityModelSynchronization`.
- Guard helpers document that downstream intelligence must use Reality Model or Executive Judgment instead of raw evidence.
- `PIERealityModelOrchestrator` exists and owns live Reality Model execution.
- Live orchestration resolves organization/project identity, loads the latest persisted Reality Model, classifies evidence deltas, synchronizes qualified evidence, persists meaningful changes, and returns model version, snapshot ID, evidence cutoff, conflicts, uncertainties, and persistence status.
- Evidence deltas include new, changed, unchanged, removed, and invalidated.
- Removed evidence creates an explicit tombstone update and preserves prior model history.
- Invalidated evidence creates an explicit contradicted Reality update instead of silently replacing prior interpretation.
- Live Reality persistence states include stale_model, conflict_blocked, and persistence_failed in addition to local/cloud/degraded identity states.
- `buildLivePIECoreIntelligence(...)` is the production-authoritative async Core path.
- The synchronous Core builder is compatibility/recovery only, not the normal live authority path.
- Home invokes the live Core authority path automatically and consumes authoritative Attention/Experience output when available.
- Live Core returns Reality authority metadata and does not report failed persistence as authoritative success.

## PIE Object Intelligence QA

JARVIS must verify Reality Objects are intelligent.

Required:

- Object intelligence fields exist: goalsSupported, relationships, dependencies, confidence, readiness, riskLevel, momentum, nextBestAction, uncertainty, and ownerNeeded.
- Object intelligence types exist: PIERealityGoal, PIERealityRelationship, PIERealityDependency, PIERealityConfidence, PIERealityReadiness, PIERealityRiskLevel, PIERealityMomentum, PIERealityNextAction, PIERealityUncertainty, and PIERealityObjectIntelligenceResult.
- Relationship types exist: belongs_to, supports, blocks, depends_on, confirms, contradicts, affects, assigned_to, scheduled_before, scheduled_after, evidence_for, risk_to, decision_for, inspection_for, and report_references.
- Readiness language exists: Ready, Needs Verification, Uncertain, and Blocked.
- Functions exist: buildRealityObjectIntelligence, identifyObjectGoals, identifyObjectRelationships, identifyObjectDependencies, calculateObjectConfidence, calculateObjectReadiness, calculateObjectRiskLevel, calculateObjectMomentum, buildObjectNextBestAction, and summarizeObjectIntelligence.
- PIECoreIntelligence exposes objectIntelligence, objectsReady, objectsUncertain, objectsBlocked, objectsWithHighRisk, objectNextBestActions, and objectRelationshipSummary.
- Downstream engines can consume objectIntelligence where practical.

## What JARVIS Tests

JARVIS should test the product from the user's point of view:

- Does the sprint align to `docs/PIE_ProductOperatingPlan.md`?
- Does the feature improve PIE, app evidence capture, or output clarity?
- Is the user kept out of unnecessary options?
- Are outputs clear and reviewable before approval or communication?
- Can a project manager understand what to do next?
- Does PIE load without visual problems?
- Do project cards show readable health, schedule, action, and location context?
- Is there one obvious primary action on daily-use screens?
- Are admin actions behind More?
- Does Capture start quickly?
- Do Review and More remain reachable?
- Does PIE provide visible recommendations?
- Does Project Assistant answer from project intelligence without external AI calls?
- Are duplicate actions removed from each daily-use page?
- Are Locations and Project Areas absent as primary workflows?
- Is the user-facing bottom nav Home / Capture / Review / Share?
- Does PIE start with a simple mission card?
- Does PIE use PIE Experience Engine to show the next user-facing experience state?
- Does the mission card show greeting, today's mission, why, one primary action, and optional small secondary action?
- Does the top mission section avoid raw cognitive engine names and dominant technical scores?
- Does Walk collect evidence for PIE rather than acting like a generic capture page?
- Does Walk consume PIE Experience Engine for the current Walk step?
- Does Walk show Experience/Conductor guidance with one dominant primary action?
- Does Walk use PIE Conductor Card to guide one action at a time?

## PIE Master Validation Gate

The final PIE validation checkpoint adds a reusable full-system scenario harness:

- `validation/scenarios/master-validation-scenarios.json`
- `validation/expected/master-validation-expected.json`
- `scripts/pie-master-validation-test.js`

Required commands:

```sh
npm run test:master-validation
npm run test:calibration
npm run test:prediction-backtest
npm run test:layer4-learning
npm run test:learning-guards
npm run test:rls-live
npm run test:jarvis-adversarial
npm run test:reporter-fidelity
npm run test:attention-quality
npm run test:failure-containment
npm run test:performance
npm run test:accessibility
npm run test:minimal-ui-complete
npm run test:security-isolation
```

`npm run jarvis:qa` must verify that these fixtures, contracts, and package scripts exist. `test:rls-live` may report external execution required when a local or test Supabase project is not linked; the remaining local/static validation still must pass.
- Does Walk start with a PIE project/area recommendation and keep Accept/Change available?
- After a photo is captured, does Walk remain active and show the next recommended action?
- Are secondary Walk controls visually subordinate or behind optional controls?
- Does Walk recommend the likely project and area before capture?
- Can the user accept or correct PIE's Walk recommendation?
- Does Review show PIE-prepared items, approvals, questions, and communication readiness?
- Does Review consume PIE Experience Engine for report workflow guidance?
- Does Review show Experience/Conductor guidance with one dominant primary action?
- Are report review flags visible in preview without being embedded into the email body by default?
- Does Review require approval before copy/email where practical and avoid automatic sending?
- Does Review support a Combined Update without sending automatically?
- Does Review / Build Update show a Generate PIE Project Update path that follows David's location-based update format?
- Does PIE Reporter require review before copy/send and avoid automatic sending?
- Does PIE Reporter read like a project-manager narrative instead of disconnected data?
- Does PIE Reporter avoid fake owner-needed action items for normal progress?
- Does PIE Reporter clean duplicated work area names before grouping by location?
- Does PIE Reporter keep system/GPS/runtime phrases out of the report body?
- Does Schedule import support PDF upload, embedded text parsing, scanned-PDF OCR guidance, and demo OCR testing?
- Does PIE fuse schedule, photo, GPS, and typed update evidence into one Runtime-backed summary?
- Are evidence gaps and conflicts visible to Runtime instead of hidden?
- Do project cards read as mini PIE briefings?
- Does the App act as the pathway between the user and PIE rather than the intelligence source?
- Does PIE visibly drive recommendations, priorities, and next best action?
- Does JARVIS verify PIE logic and App usability as separate quality dimensions?

## UI Layout Checks

JARVIS should check visible app quality on normal iPhone widths:

- Text does not wrap awkwardly.
- Labels do not split mid-word.
- Buttons do not clip.
- Primary buttons have readable text.
- Secondary actions do not overflow horizontally.
- Cards do not overlap.
- Touch targets remain large enough for field use.
- Project cards show Update as the primary action.
- More/overflow menus expose admin actions without clipping Delete.
- Schedule values use short readable labels such as On Track, Required, Behind, None, and Due Soon.
- Project cards show one primary action.
- Project cards display location context without sending the user to a separate Locations workflow.

## Navigation Checks

JARVIS should confirm all primary destinations load:

- PIE loads.
- Capture starts from bottom navigation.
- Projects loads from More.
- Project Workspace loads from a project card.
- Walk/Capture starts from PIE and bottom navigation.
- Review loads.
- More loads from the Home overflow / secondary tools surface.
- Project Assistant compatibility screen loads only as an integrated PIE fallback, not as a primary destination.
- Schedule remains reachable from More.
- Reference documents, saved updates/history, timeline, settings, admin, and diagnostics remain reachable from More.
- Bottom navigation labels are exactly Home, Capture, Review, Share.
- Developer tools and diagnostics are not primary navigation.

## Workflow Checks

JARVIS should protect the daily project-management workflows:

- Start Walk in two taps or fewer.
- Confirm Walk starts with a conductor recommendation.
- Confirm Walk shows a recommended project, area, confidence, and GPS fallback when needed.
- Accept PIE's Walk recommendation.
- Correct the recommended project.
- Correct the recommended area.
- Add a photo from Walk and remain in the Walk flow.
- Confirm the post-photo conductor recommendation appears with Add Another Photo, Add Note, or Finish Walk available.
- Add another photo, add a note, or save the Walk update after capture.
- Confirm Walk supports Finish / Review update after evidence capture.
- Create a project in under 30 seconds.
- Find a project in under 15 seconds.
- Open Project Workspace from Projects.
- Start an update from a project card.
- Save a field update.
- Review prepared updates, reports, and saved history.
- Prepare a Combined Update across multiple projects.
- Select Combined Update evidence groups before review.
- Confirm Combined Update requires review before send/copy.
- Generate a PIE report draft, review warnings, approve it, then copy or email it.
- Confirm report warnings remain preview-only unless the user intentionally includes them.
- Import a PDF schedule.
- Confirm embedded-text PDFs create schedule items when readable.
- Confirm scanned/image-only PDFs explain that OCR is required.
- Confirm Demo OCR Schedule creates realistic schedule items.
- Review and correct uncertain imported schedule items.
- Open More for diagnostics and sync.
- Review PIE recommendation before acting.
- Confirm or correct PIE location only when confidence is low or context is wrong.

## PIE Logic Checks

JARVIS should validate that PIE remains useful and local:

- PIE, the App, and the User follow the Product Operating Plan model: User -> App Evidence Capture -> PIE Processing -> App Output -> User Approval.
- New work improves PIE understanding, app evidence capture, or output clarity.
- User-facing flows reduce effort instead of forcing unnecessary options.
- PIE outputs remain clear, reviewable, and approval-bound.
- PIE Core Intelligence defines PIE as the reusable intelligence brain that can support multiple applications.
- App surfaces do not own intelligence; apps collect input and display PIE output.
- PIE Core output includes evidenceReview, interpretations, relationships, beliefs, opinions, decisionsNeeded, recommendations, explanations, learningSignals, missingData, confidence, and nextBestActions.
- PIE uses past experience to interpret new information instead of treating every input as isolated.
- PIE Memory Recall retrieves past project events, updates, photos, schedule items, recommendations, report history, user corrections, reflection lessons, and prior Core beliefs or opinions.
- PIE Memory Recall compares new evidence to past evidence and produces memoryInfluences for interpretation, recommendations, reports, attention, and experience.
- PIE Cognitive Architecture defines Observe, Understand, Recall, Reason, Form Beliefs, Challenge Itself, Decide, Simulate, Recommend, Explain, Reflect, and Learn.
- PIE Deliberation exists so important recommendations identify assumptions, contradictions, missing evidence, alternatives, trade-offs, readiness, and what would change the recommendation.
- PIE Core output includes deliberation, assumptions, alternatives, tradeoffs, recommendationReadiness, and whatWouldChangeRecommendation where practical.
- PIE owns understanding, Experience Engine owns attention and flow, and App owns interaction and display.
- PIE Experience Engine exists and turns Runtime plus Attention output into experience state instead of duplicating intelligence.
- PIE Experience Engine states include greeting, mission, collect_evidence, thinking, review, communicate, complete, and blocked.
- PIE Experience Engine Walk states include confirm_location, capture_photo, capture_note, verify_progress, continue_walk, finish_walk, and review_walk_update.
- PIE Experience Engine Review states include report_ready, report_needs_review, report_editing, report_approved, communicate_ready, and communication_complete.
- PIE Experience output includes currentState, mode, primaryMessage, reason, primaryAction, secondaryAction, nextState, confidence, needsUserInput, and userActionType.
- PIE Experience output includes currentProject and currentArea for Walk.
- PIE Experience output includes reportTitle, reportReadiness, and reviewWarnings for Review.
- Experience actions are limited to confirm, capture, correct, approve, communicate, wait, and review.
- PIE Insight appears on Home.
- PIE Attention Engine identifies one primary attention item with what matters now, why it matters, confidence, next step, and a user action type.
- PIE Conductor Card presents guidance before dashboard information on Today without removing existing navigation.
- PIE Conductor Card guides Walk through recommend project/area, confirm location, capture photo, add note, verify progress, continue to next area, finish walk, and review update states.
- PIE-guided user action types remain limited to Confirm, Capture, Correct, Approve, and Communicate.
- PIE Insight appears on Project Overview.
- Project Assistant shows Powered by PIE or PIE recommendation context.
- PIE recommends a next best action.
- PIE uses local project updates, photos, schedules, documents, areas, sync metadata, events, reasoning, and memory where available.
- PIE handles empty projects honestly.
- PIE does not call external AI services for rule-based assistant answers.
- Project Assistant can answer status, recent change, attention, schedule, boss/customer communication, next action, project story, memory gaps, recurring issue, and what PIE remembers.
- Runtime beliefs are supported by named evidence.
- Runtime recommendations include evidence and confidence.
- Runtime Trust Score, Understanding Score, and Preparedness Score are available for product surfaces.
- Runtime does not recommend action from unsupported or invented facts.
- PIE next best action is visible on daily-use screens.
- PIE owns project, location, and area intelligence unless user correction is needed.
- Runtime includes graph-backed evidence when relationships are available.
- Recommendations can expose connected evidence from the Knowledge Graph.
- Runtime identifies blocked items from graph relationships.
- Missing graph relationships are surfaced as gaps instead of hidden.
- The App renders Runtime output instead of recreating PIE intelligence in page-level logic.
- PIE remains the source of recommendations, priorities, confidence, and project understanding.
- JARVIS can review PIE logic separately from visual layout and navigation usability.
- PIE Executive priorities are evidence-backed.
- Runtime includes PIE Executive priorities, projects needing attention, escalations, preparations, questions, daily routine, and operating mode.
- PIE Executive recommendations can be traced to evidence, confidence, urgency, impact, and user approval state.
- PIE Executive escalations include clear reasons, urgency, confidence, evidence, and user action.
- PIE Executive operating mode matches the current project-management context and is visible or testable through Runtime.
- PIE Executive preserves approval boundaries and does not automatically send, close, approve, or change project status.
- PIE Executive output stays concise and actionable.
- PIE Reflection identifies weak recommendations.
- PIE Reflection identifies missing evidence.
- PIE Reflection produces verification questions.
- PIE Reflection Engine exists as the continuous learning layer.
- PIE Reflection triggers include schedule import, accepted photo, accepted note, GPS correction, project correction, area correction, report approval, walk completion, and daily reflection.
- Runtime exposes reflectionSummary, lessonsLearned, beliefChanges, confidenceChanges, recommendedEvidence, and reflectionConfidence.
- Experience consumes Reflection so missing evidence recommends collection and weakened beliefs prioritize verification.
- Reporter consumes Reflection for narrative quality, confidence wording, action recommendations, and review warnings without showing raw Reflection directly.
- PIE Reflection does not invent facts.
- PIE Reflection does not override user approval boundaries.
- PIE Reflection can explain why confidence should be reduced.
- PIE Partnership recommendations explain themselves with why, evidence, confidence, uncertainty, impact, and next action.
- User corrections improve PIE understanding instead of being ignored.
- Approvals never happen automatically.
- PIE asks useful questions that improve project understanding.
- PIE does not repeat itself without new evidence, urgency, or context.
- PIE reduces user effort instead of adding extra decisions.
- PIE behaves like a senior project manager: calm, direct, evidence-based, and action-oriented.
- PIE Mission always exists when Mission Engine output is requested.
- PIE Mission matches Runtime priorities and Executive priorities instead of competing with them.
- PIE Mission includes evidence collected and evidence still needed.
- PIE Mission has measurable success criteria.
- PIE Mission transitions correctly when complete, blocked, or superseded by higher-priority risk.
- PIE Mission never conflicts with Executive priorities or approval boundaries.
- Runtime includes current mission, mission summary, objective, progress, blockers, evidence, recommendations, success criteria, completion state, and next mission.
- Runtime mission output aligns with Executive priorities and does not compete with the next best action.
- Runtime exposes a mission-backed line where applicable, such as "Current Mission: Reduce Project Uncertainty."
- Runtime includes fused evidence, evidence fusion summary, intelligent summary, evidence gaps, and evidence conflicts.
- Evidence Fusion treats schedule as the primary source for milestones, overdue work, upcoming work, schedule risk, next work, priority, and executive summary context.
- Imported CSV/PDF/OCR/demo schedule items appear in fused schedule evidence and affect Runtime recommendations when applicable.
- Photo evidence includes captions, categories, action required, owner, due date, status, area, timestamp, issue/safety flags, and GPS metadata where available.
- GPS evidence includes availability, recommended project, recommended area, confidence, nearest mapped area, and Project Walk support.
- Typed update evidence includes notes, issues, safety mentions, decisions, blockers, next steps, recipients, and communication readiness when available.
- Evidence Fusion surfaces missing schedule, photos, GPS, typed updates, document context, report history, and schedule ownership as gaps.
- Evidence Fusion surfaces conflicts such as completed schedule work with open issues, GPS/update area mismatch, and closed actions with overdue due dates.
- Runtime Trust Score, Understanding Score, and Preparedness Score account for evidence fusion gaps and conflicts.
- Evidence Fusion does not invent facts and does not hide uncertainty.

## Release Readiness Checks

Before TestFlight release, JARVIS QA should confirm:

- Sprint scope aligns to the PIE Product Operating Plan.
- The change improves PIE, evidence capture, or output clarity.
- The user is not forced into unnecessary options.
- Outputs are clear and reviewable before communication.
- `npm run check` passes.
- No daily-use screen has clipped controls.
- No primary labels are broken across lines.
- No horizontal overflow appears on iPhone-size screens.
- Home, Capture, Review, Share, Project Workspace, and Project Assistant compatibility all load.
- Projects, Schedule, Documents, History, Settings, Admin, and Developer Tools remain reachable from More.
- Bottom navigation is Home / Capture / Review / Share.
- Developer tools and diagnostics are not primary navigation.
- PIE starts with a mission card that answers what the user should do now.
- PIE uses Experience Engine near the top to render primary message, reason, primary action, secondary action, and next state.
- PIE mission card includes greeting, today's mission, why, one primary action, and optional secondary action.
- Technical scores are not dominant on the normal top section; use Ready, Needs Verification, Uncertain, or Blocked language instead.
- Existing navigation and feature entry points remain available below the mission card.
- Normal user-facing UI must hide internal cognitive engine names such as Scientific Method, Pattern Engine, Belief Engine, Deliberation, Reflection Engine, Learning Engine, Runtime, Knowledge Graph, Evidence Fusion, Core Intelligence, and Prediction Engine.
- Normal user-facing UI must not expose raw diagnostics, OCR/API endpoint wording, vendor names, REST/JSON details, stack traces, or confidence percentages.
- Technical and raw support details must remain reachable only through More -> Developer Tools -> Developer Support -> Diagnostics.
- Major screens should use plain language: what matters, why, what PIE needs, and the next action.
- Capture starts with PIE-guided evidence collection: PIE needs, why, and one dominant primary action.
- Capture shows location confirmation in plain language: PIE believes you are at Project / Area, with Accept and Correct available.
- Capture hides GPS technical detail from the normal top experience and keeps raw location reasoning behind Walk Options.
- Capture preserves Upload Document, Add Note, Add Issue, Add Safety, Add From Library, and Finish Walk as lower-weight controls.
- Photo capture keeps the user in Capture and returns to a clear next recommendation.
- After-photo recommendation appears with Photo saved, Current Area, Next Suggested Action, Add Another Photo, Add Note, and Finish Walk still available.
- Review shows PIE prepared items, Executive Brief, Customer Update, Project Summary, open decisions, questions, reports ready for review, approval required, and communication readiness.
- Review uses Experience Engine to guide Generate PIE Project Update, Review Draft, Edit Report, Approve Report, Copy Report, and Email Report.
- Review keeps report warnings visible in preview and out of the default email body.
- Review preserves existing report options while keeping one dominant primary report action.
- Project cards show mini PIE briefings with mission, area/location context, health, trust/confidence, understanding, current concern, and next PIE recommendation.
- Project cards show readable status, schedule, Update, More, and location context.
- Delete remains available only through More and still requires confirmation.
- PIE recommendations are visible and action-oriented.
- PIE next best action is visible.
- PIE beliefs are evidence-backed.
- Trust Score is displayed where reliability matters.
- Understanding Score is displayed where completeness matters.
- Preparedness Score is displayed where the user is preparing for meetings, reports, walks, or decisions.
- No recommendation appears without evidence, confidence, impact, and a suggested next action.
- Graph-backed recommendations expose connected evidence where available.
- Blocked items are identified when graph relationships show an issue blocking schedule or project work.
- Missing relationships are surfaced as graph gaps.
- The App still acts as a pathway for capture, verification, correction, approval, and presentation.
- PIE is visibly driving recommendations and next best action.
- JARVIS verifies PIE logic separately from App usability and layout.
- PIE Executive priorities are evidence-backed.
- Runtime exposes PIE Executive outputs for release review.
- PIE Executive recommendations are evidence-backed.
- PIE Executive escalations require clear reasons.
- PIE Executive preserves user approval boundaries.
- PIE Executive operating mode is visible or testable and appropriate for the current context.
- No automatic send, close, approve, status-change, safety, schedule, stakeholder, or commitment behavior is introduced.
- PIE Executive output is concise and actionable.
- PIE Reflection flags weak recommendations when evidence or confidence is low.
- PIE Reflection flags missing evidence such as photos, schedule support, inspection status, stale updates, and graph gaps.
- PIE Reflection provides verification questions for user review.
- PIE Reflection preserves approval boundaries and does not act automatically.
- PIE Reflection explains confidence reduction with evidence.
- PIE Partnership behavior is visible in recommendations, questions, explanations, and prepared work.
- User corrections, rejections, approvals, and delays are treated as feedback signals for future PIE improvement.
- Recommendations explain themselves before asking for user action.
- PIE asks useful questions and avoids repetitive prompts.
- PIE reduces user effort while preserving approval boundaries.
- PIE behaves like a senior project manager, not a chatbot or uncontrolled automation tool.
- PIE Mission output exists for current project or daily context when Mission Engine is used.
- PIE Mission purpose aligns with Runtime current priority and Executive operating mode.
- PIE Mission recommendations are evidence-backed and list evidence still needed.
- PIE Mission success criteria are measurable and reviewable.
- PIE Mission transitions are explainable and do not skip user approval.
- PIE Mission does not send, close, approve, change status, or communicate automatically.
- Walk recommendations use GPS, Area Mapping, recent activity, or last active project as explainable sources.
- Photo evidence captured in Walk carries project, area, and GPS context where available.
- Combined Updates compile selected Walk evidence, photos, saved updates, open issues, safety observations, schedule changes, and PIE recommendations.
- Combined Updates never send automatically and must remain user-reviewed.
- PIE Reporter generates daily and combined project update drafts with the required opening, location groups, numbered work areas, bullets, action items, image references, and closing.
- PIE Reporter uses fused evidence, Runtime, schedule, photos, GPS/location context, user notes, issues, safety observations, and saved updates without inventing facts.
- PIE Reporter avoids generic AI wording in the default report body and keeps the body in David's concise project update style.
- PIE Reporter builds construction understanding before report formatting and does not dump raw facts.
- PIE Reporter only creates action items from explicit owners, strong action language, blockers, safety concerns, or decisions.
- PIE Reporter never creates "Owner needed" action items for normal progress statements.
- PIE Reporter normalizes duplicated work area names such as Building 2321 East Driveway East Driveway, Fire Pump House Pump House, and Canopy B Location.
- PIE Reporter suppresses Location was captured, GPS was captured, Evidence was fused, Runtime indicates, and No image references included from report bullets.
- PIE Reporter includes image references only when photos exist.
- PIE Reporter exposes report draft, readiness, review state, and action items through Runtime where practical.
- Schedule PDF import does not silently fail.
- Imported schedule items feed PIE Runtime, Mission, Knowledge Graph, Decision Engine, Today priorities, project cards, Project Workspace, Review, and schedule concern logic through the shared schedule store.
- Schedule import summaries show item count, milestones, overdue, upcoming 7/14/30 days, missing project, missing area, and items needing review.
- Evidence Fusion summaries show schedule count, milestones, overdue/upcoming work, photo count, GPS availability, update count, issue/safety count, gap count, conflict count, confidence, and trust.
- Intelligent Summary explains project status, what changed, schedule status, photo evidence, GPS confidence, update notes, risks/issues, safety, missing information, PIE recommendation, trust, and next action.
- Runtime includes current mission output for release review.
- Runtime mission output includes objective, evidence, blockers, and success criteria.
- Runtime mission recommendations preserve approval boundaries.
- A mission line is visible where applicable in existing PIE briefing sections.
- Location intelligence appears as context, not as a primary workflow.
- Project Areas and Locations do not appear as primary user workflows.
- Area Mapping, if needed, is hidden under Advanced Configuration.
- No duplicate action appears on the same page.
- Project cards display location context and one primary Update action.
- No Supabase schema changes were introduced unintentionally.
- No external AI calls were added to local PIE/assistant logic.

## PIE Presence Release Gate

A feature is complete only if both conditions are true:

1. PIE became smarter.
2. The user can clearly perceive the improvement.

JARVIS should reject intelligence work that only improves internal calculations without making the product easier to understand, faster to act on, or clearer about what PIE knows.

JARVIS should also reject UI work that makes PIE more visible without improving or accurately exposing real PIE output.

Release review should ask:

- Does the screen show what PIE knows?
- Does the screen show what changed?
- Does the screen show what concerns PIE?
- Does the screen show what PIE recommends?
- Does the screen show what PIE needs from the user?
- Are Trust Score and Understanding Score visible where they help the user judge reliability?
- Is Preparedness Score visible where the user is preparing for a meeting, report, walk, or decision?
- Are current beliefs backed by supporting evidence?
- Are contradictions and remaining uncertainty surfaced instead of hidden?
- Does every recommendation trace back to evidence and confidence?
- Is the next best action obvious?
- Is there only one primary action per project card?
- Are duplicate page actions removed or moved behind More/overflow?
- Is Area Mapping hidden as advanced configuration rather than presented as a normal feature?
- Is the user still responsible for approval when action affects project status, safety, schedule, stakeholders, or communication?

## JARVIS QA Checklist

Use this checklist before release handoff:

- [ ] Text does not wrap awkwardly.
- [ ] Buttons do not clip.
- [ ] Primary actions are obvious.
- [ ] No horizontal overflow appears.
- [ ] Bottom nav is Home / Capture / Review / Share.
- [ ] PIE loads.
- [ ] Projects loads from More.
- [ ] Project Workspace loads.
- [ ] Walk starts.
- [ ] Walk recommends project and area.
- [ ] Walk recommendation displays confidence.
- [ ] GPS unavailable fallback is clear.
- [ ] User can accept the Walk recommendation.
- [ ] User can correct the recommended project.
- [ ] User can correct the recommended area.
- [ ] Photo can be added with fewer taps from Walk.
- [ ] User remains in Walk after adding a photo.
- [ ] Added-photo confirmation names the project and area.
- [ ] Quick actions appear after photo capture: add another photo, add note, save Walk update.
- [ ] Review loads.
- [ ] Combined Update option exists in Review.
- [ ] Combined Update can include multiple projects.
- [ ] Combined Update can toggle evidence groups.
- [ ] Combined Update requires review before sending or copying.
- [ ] No automatic send happens from Combined Update.
- [ ] PDF schedule upload works.
- [ ] Embedded-text PDF parses into schedule items when readable.
- [ ] Scanned/image-only PDF explains OCR is required.
- [ ] OCR endpoint status is visible.
- [ ] Required OCR JSON schema is visible.
- [ ] Test OCR Endpoint gives a clear success/failure message.
- [ ] Demo OCR Schedule import works.
- [ ] Imported schedule items feed PIE surfaces.
- [ ] Import summary appears.
- [ ] Import summary includes milestones, overdue, upcoming 7/14/30, missing project, missing area, and review-needed counts.
- [ ] No schedule import path fails silently.
- [ ] User can review uncertain imported items.
- [ ] User can correct imported task name, project, area, dates, owner, contractor, status, priority, milestone, progress, and notes.
- [ ] More loads.
- [ ] PIE Insight appears on Today.
- [ ] PIE Insight appears on Project Workspace.
- [ ] Project Assistant compatibility answers project questions without being a primary nav item.
- [ ] PIE starts with a mission card.
- [ ] Mission card includes greeting.
- [ ] Mission card includes why/reason.
- [ ] Mission card has one dominant primary action.
- [ ] Technical scores are not dominant in the top section.
- [ ] Walk collects evidence for PIE.
- [ ] Review shows prepared and approval-required items.
- [ ] Project cards show mini PIE briefings.
- [ ] Location context appears on project cards.
- [ ] No visible Project Areas or Locations primary workflow appears.
- [ ] Area Mapping is hidden under Advanced Configuration.
- [ ] One primary action appears per project card.
- [ ] No duplicate actions appear on the same page.
- [ ] PIE next best action is visible.
- [ ] Runtime beliefs have supporting evidence.
- [ ] Trust Score appears where reliability matters.
- [ ] Understanding Score appears where completeness matters.
- [ ] Preparedness Score appears where readiness matters.
- [ ] Recommendations do not appear without evidence.
- [ ] Runtime includes graph-backed evidence when available.
- [ ] Recommendations can show connected evidence.
- [ ] Blocked items are identified from graph relationships.
- [ ] Missing relationships are surfaced as graph gaps.
- [ ] App surfaces Runtime output instead of becoming the intelligence source.
- [ ] PIE Core Intelligence service exists.
- [ ] PIE Core output includes evidence review, interpretation, relationship analysis, belief formation, opinion formation, decision support, recommendation, explanation, reflection, and learning.
- [ ] Architecture docs define PIE as a reusable intelligence brain that can support multiple future applications.
- [ ] App docs do not describe the app as owning intelligence.
- [ ] PIE Memory Recall service exists.
- [ ] Memory Recall compares new evidence to past events, updates, photos, schedule items, recommendations, corrections, lessons, and Core beliefs or opinions.
- [ ] PIE Core Intelligence consumes Memory Recall before forming interpretations, beliefs, opinions, recommendations, and explanations.
- [ ] Reflection produces lessons and caution notes that Memory Recall can use later.
- [ ] Reporter can use past context only when it improves narrative clarity.
- [ ] Experience and Attention can use memory influence to ask for verification.
- [ ] PIE Cognitive Architecture doc exists.
- [ ] PIE Deliberation Model doc exists.
- [ ] PIE Deliberation Engine exists.
- [ ] Deliberation identifies assumptions, contradictions, missing evidence, alternatives, scores, trade-offs, readiness, and what would change the recommendation.
- [ ] PIE Core Intelligence consumes Deliberation before final recommendations and opinions where practical.
- [ ] Attention, Experience, and Reporter can use deliberation without dumping raw deliberation into normal UI or reports.
- [ ] PIE visibly drives recommendations and next best action.
- [ ] JARVIS verifies PIE logic and App usability separately.
- [ ] PIE Executive priorities are evidence-backed.
- [ ] Runtime includes PIE Executive priorities.
- [ ] Runtime includes PIE Executive projects needing attention.
- [ ] Runtime includes PIE Executive preparations and questions.
- [ ] PIE Executive recommendations can show evidence, confidence, urgency, impact, and approval state.
- [ ] PIE Executive escalations include clear reasons.
- [ ] PIE Executive preserves user approval boundaries.
- [ ] PIE Executive operating mode is visible or testable and appropriate.
- [ ] PIE Executive does not automatically send, close, approve, or change status.
- [ ] PIE Executive output is concise and actionable.
- [ ] PIE Reflection identifies weak recommendations.
- [ ] PIE Reflection identifies missing evidence.
- [ ] PIE Reflection produces verification questions.
- [ ] PIE Reflection Engine exists with reflection events, lessons, belief changes, confidence changes, recommendation improvements, and summary output.
- [ ] PIE Reflection triggers after schedule import, accepted photo, accepted note, GPS correction, project correction, area correction, report approval, walk completion, and daily reflection.
- [ ] Runtime exposes reflectionSummary, lessonsLearned, beliefChanges, confidenceChanges, recommendedEvidence, and reflectionConfidence.
- [ ] Experience consumes Reflection to collect missing evidence and verify weakened beliefs.
- [ ] Reporter consumes Reflection indirectly for narrative, confidence, action recommendations, and preview warnings.
- [ ] PIE Reflection does not invent facts.
- [ ] PIE Reflection preserves user approval boundaries.
- [ ] PIE Reflection explains why confidence should be reduced.
- [ ] PIE Partnership recommendations explain why, evidence, confidence, uncertainty, impact, and next action.
- [ ] User corrections improve PIE understanding.
- [ ] Approvals never happen automatically.
- [ ] PIE asks useful questions.
- [ ] PIE does not repeat itself without new evidence, urgency, or context.
- [ ] PIE reduces user effort.
- [ ] PIE behaves like a senior project manager.
- [ ] PIE Mission exists when Mission Engine output is requested.
- [ ] PIE Mission matches Runtime and Executive priorities.
- [ ] PIE Mission has evidence.
- [ ] PIE Mission has measurable success criteria.
- [ ] PIE Mission transitions correctly.
- [ ] PIE Mission never conflicts with Executive priorities or approval boundaries.
- [ ] Runtime includes current mission.
- [ ] Runtime mission output has objective, evidence, blockers, and success criteria.
- [ ] Runtime mission aligns with Executive priorities.
- [ ] Runtime mission does not bypass user approval.
- [ ] Mission line is visible where applicable.
- [ ] Project card Update action is readable.
- [ ] Favorite, Rename, Archive, Restore, and Delete are inside More/overflow.
- [ ] Schedule card values are short and readable.
- [ ] Empty states are helpful when project data is missing.
- [ ] `npm run check` passes.

## Active V.I.C. Runners

V.I.C. keeps its lightweight static contract audit available through a compatibility command:

```bash
npm run jarvis:contracts
```

`jarvis:contracts` verifies required architecture, documentation, exports, safety boundaries, and source markers. Its score is a static contract score only. It does not prove runtime behavior or visual correctness.

The complete automated runner is:

```bash
npm run jarvis:qa
```

It runs release configuration, architecture, strict Jest behavior and coverage, established domain scenarios, UI and reporting checks, core-flow simulation, photo intelligence, authority and safety checks, the escaped-defect coverage audit, a production web export, and the static contract audit. It continues through all layers to provide one complete failure report.

Release configuration now verifies both the Expo source configuration and any checked-in generated Android manifest. The gate fails if Android OS backup is enabled or if the generated app actively requests broad external-storage, contact-write, or overlay permissions. Release contracts also exercise the production-secret guard against an untracked runtime dependency and require mobile/web data-export copy to state that the JSON is unencrypted and does not contain photo or document files.

`validation/jarvis/escaped-defects.json` keeps previously escaped defect families visible. Every entry identifies severity, affected platforms, executable regression evidence, required manual validation, and the limitation of the automated evidence. V.I.C. fails when a registered evidence file disappears or is disabled.

The active runner checks the highest-risk pre-field-test pathways:

- PIE Product Operating Plan exists and defines the User -> App Evidence Capture -> PIE Processing -> App Output -> User Approval loop.
- Master Architecture and JARVIS QA reference the Product Operating Plan as the sprint alignment gate.
- New sprint checks protect PIE improvement, app evidence capture, output clarity, reduced user effort, and clear reviewable outputs.
- PIE Core Intelligence service exists and exposes evidenceReview, interpretations, relationships, beliefs, opinions, decisionsNeeded, recommendations, explanations, learningSignals, missingData, confidence, and nextBestActions.
- PIE Core Intelligence docs define PIE as a reusable intelligence brain and keep app ownership separate from intelligence ownership.
- PIE Memory Recall service exists with relevant memory types, comparison functions, recall influences, Core integration, Reflection lessons, Reporter context, Experience/Attention verification hooks, and documentation that PIE uses past experience to interpret new information.
- PIE Cognitive Architecture and Deliberation Model docs exist, and PIEDeliberationEngine identifies assumptions, contradictions, missing evidence, alternatives, scores, trade-offs, readiness, and recommendation-change conditions.
- PIE Core Intelligence consumes Deliberation and exposes deliberation, assumptions, alternatives, tradeoffs, recommendationReadiness, and whatWouldChangeRecommendation.
- PIE Experience Engine exists with required states, modes, actions, output contract, transitions, and Today usage.
- PIE Experience Engine supports Walk/Capture states and Capture uses it to guide confirm location, capture photo, add note, continue, finish, and review update steps.
- PIE Experience Engine supports Review states and Review uses it to guide report readiness, review, editing, approval, communication readiness, and completion.
- Experience Engine consumes PIE Attention and Runtime instead of duplicating intelligence.
- PIE Reflection Engine exists, supports all requested reflection triggers including daily reflection, and answers what changed, prior beliefs, strengthened/weakened beliefs, PIE correctness, verification needs, and next evidence.
- Runtime exposes Reflection summary, lessons learned, belief changes, confidence changes, recommended evidence, and reflection confidence.
- Experience consumes Reflection to recommend missing evidence collection and verification for weakened beliefs.
- Reporter consumes Reflection indirectly for narrative quality, confidence wording, action recommendations, and preview warnings.
- Bottom navigation labels: Home, Capture, Review, Share.
- Schedule Import screen presence.
- Demo OCR schedule option presence.
- OCR missing-endpoint handling.
- Schedule Intelligence pipeline for import, format detection, text extraction, normalization, review, Runtime, Mission, Executive, and Knowledge Graph feeds.
- PDF text detected and scanned/flattened PDF detected pathways.
- Schedule normalization into project, area, task, WBS, milestone, dates, duration, status, percent complete, owner, contractor, critical, float, dependencies, notes, confidence, and review fields.
- Schedule item flow into PIE/Runtime surfaces.
- Runtime schedule intelligence contract: scheduleSummary, upcomingTasks, overdueTasks, criticalTasks, milestones, recommendedWalkAreas, and scheduleConfidence.
- Mission, Executive, and Knowledge Graph schedule feeds.
- Evidence Fusion service presence.
- Runtime Evidence Fusion contract: fused evidence, fusion summary, intelligent summary, gaps, and conflicts.
- Photo Progress comparison service presence.
- Photo comparison generation from project, area, GPS proximity, time, and user-selected comparison markers.
- Photo comparison confidence and no-fabricated-change guardrails.
- Low-confidence photo comparison review prompt: "Does this summary look correct?" with Accept, Edit, Reject.
- Runtime photo progress contract: photoProgressSummary, lastComparison, comparisonConfidence, visualProgressEstimate, and comparisonNeedsReview.
- Accepted photo comparison evidence feeds Runtime, Mission, Executive, Evidence Fusion, Knowledge Graph, Review, and Combined Update pathways.
- Walk page presence.
- Walk Experience Engine integration.
- Review Experience Engine integration.
- GPS project and area recommendation code.
- Accept/correct project and area controls.
- Photo add flow staying in Walk.
- Missing photo sync error handling.
- Combined Update option and review-before-send boundary.
- Project Areas/Locations not appearing as primary workflows.
- More contains Projects, Schedule, Documents, History, Settings, Admin, and Developer Tools.
- Admin diagnostics placement under Developer Tools / Developer Support, not as a normal More/Admin card.
- PIE mission card on PIE/Home.
- Project cards showing PIE-driven location, mission, and next action.
- PIE Cognitive Constitution presence.
- PIE Scientific Method service presence.
- Scientific Method loop: Question, Observe, Evidence, Interpret, Recall, Hypothesize, Challenge, Alternatives, Predict, Decide, Explain, Monitor, Reflect, Learn.
- Scientific Method uncertainty, hypothesis, self-challenge, and decision quality models.
- PIE Core Intelligence consumes Scientific Method and exposes scientificResult, primaryHypothesis, challengedAssumptions, primaryUncertainty, uncertaintyReductionActions, and decisionQualitySignals.
- Architecture docs state PIE uses Scientific Method.
- Important recommendations include uncertainty reduction where practical.
- PIEPatternEngine exists.
- Pattern types exist for schedule slippage, contractor slowdown, inspection risk, safety recurrence, missing evidence, repeated user correction, blockers, recovery, successful resolution, failed recommendation, communication gaps, resource constraints, and quality concerns.
- Pattern matching, similarity scoring, early warning detection, timelines, pattern recommendations, recurring issue detection, recovery detection, and failed pattern detection exist.
- Pattern Engine consumes Memory Recall and Reflection context.
- Scientific Method consumes Pattern Intelligence.
- PIE Core Intelligence exposes patternIntelligence, patternMatches, earlyWarnings, recurringPatterns, patternBasedRecommendations, and patternConfidence.
- Reporter can use pattern context without overusing history or dumping raw pattern analysis.
- Documentation explains Pattern Intelligence, Recurring Pattern Detection, Early Warning Signals, and Historical Recovery Patterns.
- PIEBeliefEngine exists.
- Belief types, status, confidence, evidence, contradiction, assumption, revision, history, explanation, readiness, uncertainty, and change models exist.
- Supporting evidence, contradicting evidence, weakest assumption, belief readiness, belief revision, belief explanation, and belief retirement functions exist.
- Scientific Method produces belief candidates and Belief Engine consumes hypotheses, challenges, uncertainty, selected decisions, and recommended next evidence.
- Pattern Engine can strengthen, weaken, or challenge beliefs.
- Memory Recall exposes related prior beliefs and Reflection belief changes feed Belief Engine.
- PIE Core Intelligence exposes beliefs, beliefChanges, strongestBeliefs, challengedBeliefs, beliefsNeedingVerification, beliefReadiness, and beliefExplanations.
- Experience and Attention can use beliefs needing verification.
- Reporter can use beliefs to improve narrative without presenting beliefs as final truth.
- Documentation explains Belief Formation, Belief Revision, Evidence vs Belief, Belief Readiness, and Belief Explainability.

Static contract statuses:

- `PASS`: expected pathway marker is present.
- `WARN`: pathway exists partially or placement needs human review before release.
- `FAIL`: critical pathway marker is missing and should block field testing.

## Active QA Release Gate

Before TestFlight or field testing, run the combined local release gate:

```bash
npm run qa:release
```

`qa:release` invokes the same full automated runner as `jarvis:qa`. Its summary deliberately separates `Automated Gate` from `Release Certification`. An automated PASS still reports `DEVICE VALIDATION REQUIRED`.

Then run Maestro and physical-device validation for the coherent build milestone. A release is blocked by any executable failure or V.I.C. `FAIL`. A `WARN` requires review and either a fix or a conscious release note explaining the remaining risk. Live iPhone/iPad/web propagation, native device capabilities, touch latency, external providers, and visual review are not certified by a local automated run.

## QA Foundation

The original JARVIS implementation established a useful static contract runner. The current foundation separates compile safety, executable Jest behavior, existing domain scenarios, static JARVIS contracts, Maestro workflows, and physical-device validation.

This separation is intentional:

- A static marker cannot substitute for runtime behavior.
- A unit test cannot substitute for an end-to-end field workflow.
- A simulator cannot fully substitute for camera, location, sync, and native sign-in on the physical phone.
- Each passing command communicates exactly which risk was checked.

The release gate does not alter Supabase, storage, schema, authentication, or external AI configuration.

## Future Automated Screenshot Comparison

JARVIS should eventually capture approved screenshots for key screens:

- PIE
- Projects from More
- Project Overview
- Capture
- Reports
- More
- Project Assistant

Future screenshot checks should compare current builds against approved baselines and flag:

- text clipping
- mid-word wrapping
- hidden buttons
- horizontal overflow
- broken cards
- missing PIE Insight surfaces
- missing project location context

Screenshot comparison should start as a release aid, not a blocking system, until baselines are stable.

## Future Maestro Tests

Maestro is the recommended first E2E automation layer.

Initial Maestro flows should test:

- Open PIE.
- Start Capture.
- Open Projects from More.
- Open the first Project Overview.
- Tap Update on a project card.
- Open More on a project card and confirm admin actions are visible.
- Open Reports.
- Open More.
- Open Project Assistant.
- Ask a suggested Project Assistant question.

Future Maestro checks should also capture screenshots after each major screen loads so JARVIS can review navigation and visual quality together.

## Future JARVIS Direction

JARVIS QA should grow into an internal assistant that can:

- run local checks
- inspect screenshots
- verify product rules
- measure workflow speed
- summarize release risk
- confirm PIE output quality
- recommend whether a build is ready for TestFlight

JARVIS should test Project Vision AI the way a project manager experiences it: fast, clear, readable, and guided by practical project intelligence.

## PIE Executive Reasoning QA

JARVIS must verify:

- PIEExecutiveReasoning service exists.
- Executive priority ranking exists.
- Biggest risk detection exists.
- Highest-value action exists.
- Decision needs exist.
- Action scoring exists.
- Decision scoring includes expected value, risk reduction, uncertainty reduction, schedule impact, safety impact, communication impact, effort level, readiness, and why recommended.
- Readiness includes Ready, Needs Verification, Uncertain, and Blocked.
- Executive Reasoning consumes Belief Engine strongest beliefs, challenged beliefs, beliefs needing verification, belief readiness, and contradicting evidence.
- Executive Reasoning consumes Pattern Intelligence, Memory Recall, Scientific Method, and Deliberation signals.
- PIECoreIntelligence exposes executiveReasoning, executivePriorities, biggestRisk, highestValueAction, decisionsNeeded, executiveBriefingPoints, and executiveReadiness.
- Attention and Experience consume Executive Reasoning where practical.
- Reporter uses Executive Reasoning for better executive summaries, confidence wording, action recommendations, and review warnings.
- Documentation defines Executive Reasoning, Decision Scoring, Highest-Value Action, Executive Risk, and Executive Judgment.

## PIE Predictive Simulation QA

JARVIS must verify:

- PIEPredictiveEngine service exists.
- Prediction scenarios exist for schedule_delay, inspection_delay, contractor_delay, missing_evidence, safety_issue, quality_issue, decision_delay, recovery_plan, no_action, best_case, most_likely, and worst_case.
- Best case, most likely, worst case, and no-action simulations exist.
- Cascading impacts exist.
- Recovery actions exist.
- Dependencies include schedule predecessor/successor, inspection dependency, contractor dependency, material dependency, approval dependency, safety dependency, and evidence dependency.
- Predictions consume beliefs, belief readiness, recurring patterns, Scientific Method hypotheses/uncertainty, Deliberation alternatives, and Executive Reasoning where practical.
- Executive Reasoning consumes predictions for predicted schedule impact, risk propagation, recovery action value, and no-action consequence.
- PIECoreIntelligence exposes predictions, mostLikelyOutcome, bestCaseOutcome, worstCaseOutcome, noActionOutcome, cascadingImpacts, recoveryActions, and predictionConfidence.
- Attention elevates high-impact predictions.
- Experience can prioritize urgent predicted risks.
- Reporter mentions predicted impact only when evidence is strong and avoids overstating weak predictions.
- Documentation defines Predictive Simulation, Scenario Analysis, No-Action Simulation, Cascading Impact, and Recovery Planning.

## PIE Continuous Learning QA

JARVIS must verify:

- PIELearningEngine service exists.
- Learning types include PIELearningSignal, PIELearningEvent, PIELearningSource, PIELearningOutcome, PIELearningLesson, PIELearningAdjustment, PIELearningPatternUpdate, PIELearningBeliefUpdate, PIELearningConfidenceCalibration, PIELearningRecommendationImprovement, PIELearningMemoryConsolidation, PIELearningDecisionQuality, and PIELearningResult.
- Learning sources include user_correction, report_approval, report_edit, recommendation_accepted, recommendation_rejected, prediction_confirmed, prediction_failed, reflection_lesson, pattern_match, schedule_change, photo_evidence, GPS_correction, and decision_outcome.
- Learning functions include buildPIELearning, extractLearningSignals, learnFromUserCorrections, learnFromReportApproval, learnFromReportEdits, learnFromRecommendationOutcome, learnFromPredictionOutcome, learnFromReflection, calibrateConfidence, updatePatternLearning, updateBeliefLearning, consolidateMemory, buildFutureAdjustment, and summarizeLearning.
- Learning answers what PIE learned, what PIE should trust more, what PIE should trust less, and what PIE should do differently next time.
- Reflection produces learningSignals.
- Memory Recall consumes Learning and can recall learning_signal memory, preference pattern, failed response, successful response, and user correction pattern.
- Pattern Intelligence consumes Learning pattern updates and recommendation improvements.
- Belief System consumes Learning belief updates and confidence calibration.
- Predictive Simulation consumes Learning confidence calibration from confirmed or failed prediction outcomes.
- PIECoreIntelligence exposes learningResult, learningSignals, lessonsLearned, confidenceCalibration, futureAdjustments, memoryConsolidation, and decisionQualityLearning.
- Reporter consumes Learning for report style, confidence wording, action recommendations, and review warnings without automatic sending.
- Continuous Learning documentation defines Outcome-Based Learning, Confidence Calibration, Memory Consolidation, Decision Quality Learning, and Report Style Learning.
- PIE Learning must not invent lessons when no correction, approval, edit, outcome, Reflection lesson, or decision result exists.

## PIE Situation Intelligence QA

JARVIS must verify:

- PIESituationIntelligence service exists.
- Situation states include stable, improving, worsening, blocked, uncertain, ready, needs_verification, and at_risk.
- Intent Recognition is part of Situation Intelligence.
- Intent types include daily progress walk, inspection preparation, executive update, customer update, contractor follow-up, schedule risk review, safety review, issue resolution, decision preparation, document review, project status review, and unknown.
- Situation output includes changes, risks, opportunities, unknowns, blockers, priorities, readiness, summary, and explanation.
- PIECoreIntelligence exposes currentSituation, situationIntent, situationState, situationChanges, situationRisks, situationOpportunities, situationUnknowns, situationBlockers, situationPriorities, and situationSummary.
- Executive Reasoning, Predictive Simulation, Reporter, Attention, and Experience consume Situation Intelligence where practical.
- Reporter writes from the current situation rather than raw evidence alone.
- Attention prioritizes current situation risks.
- Experience guides from situation state.

## PIE Predictive Reality QA

JARVIS must verify:

- PIEPredictiveReality service exists.
- Predictive Reality types include PIEPredictiveReality, PIEFutureObjectState, PIERealityForecast, PIECascadingEffect, PIEReadinessForecast, PIERealityEvolution, PIEPredictiveRealityRisk, PIEPredictiveRealityOpportunity, and PIEPredictiveRealityResult.
- Forecast types include most_likely, best_case, worst_case, no_action, and recovery_action.
- Functions include buildPIEPredictiveReality, forecastObjectStates, forecastReadiness, forecastCascadingEffects, forecastRealityEvolution, buildNoActionForecast, buildRecoveryForecast, identifyPredictiveRealityRisks, identifyPredictiveRealityOpportunities, summarizePredictiveReality, and explainPredictiveReality.
- Predictive Reality consumes Reality Model, Object Intelligence, Situation Intelligence, Evidence Timeline, Beliefs, Patterns, Predictive Engine outputs, and Missing Evidence.
- PIECoreIntelligence exposes predictiveReality, futureObjectStates, readinessForecasts, cascadingEffects, cascadingRealityEffects, noActionForecast, noActionOutcomes, recoveryForecast, recoveryPaths, and predictiveRealitySummary.
- Executive Reasoning consumes Predictive Reality for decision scoring.
- Attention prioritizes high-impact future risks.
- Experience requests evidence that changes the forecast.
- Reporter mentions future impact only when confidence is strong enough.

## PIE Executive Judgment QA

JARVIS must verify:

- PIEExecutiveJudgment service exists.
- Executive Judgment types include PIEExecutiveJudgment, PIEExecutiveJudgmentResult, PIEExecutiveAction, PIEExecutiveActionType, PIEExecutiveDecision, PIEExecutivePriority, PIEExecutiveRisk, PIEExecutiveOpportunity, PIEExecutiveConstraint, PIEExecutiveTradeoff, PIETradeoffAnalysis, PIETradeoffOption, PIETradeoffDimension, PIEEscalationAnalysis, PIEEscalationTrigger, PIEEscalationTarget, PIEOpportunityCost, PIEDecisionTiming, PIENoActionReasoning, PIEWaitForEvidenceReasoning, PIEExecutiveActionSafetyCheck, PIEExecutiveResourceNeed, PIEExecutiveEscalation, PIEExecutiveGovernance, PIEExecutiveReadiness, and PIEExecutiveJudgmentExplanation.
- Action types include verify, capture_evidence, escalate, wait, communicate, assign_owner, approve, reject, monitor, recover_schedule, resolve_blocker, inspect, defer, and no_action.
- Readiness includes Ready, Needs Verification, Uncertain, and Blocked.
- Functions include buildPIEExecutiveJudgment, identifyExecutiveDecisions, rankExecutivePriorities, identifyExecutiveRisks, identifyExecutiveOpportunities, identifyExecutiveConstraints, buildExecutiveActions, scoreExecutiveActions, selectHighestValueAction, analyzeExecutiveTradeoffs, compareExecutiveOptions, calculateOpportunityCost, analyzeEscalationNeed, identifyEscalationTriggers, determineEscalationTarget, evaluateDecisionTiming, evaluateNoActionOption, evaluateWaitForEvidenceOption, explainTradeoffDecision, explainExecutiveJudgment, and summarizeExecutiveJudgment.
- Decision scoring includes value created, risk reduced, uncertainty reduced, schedule impact, safety impact, quality impact, communication impact, effort required, urgency, reversibility, confidence/readiness, downstream effect, and readiness language.
- Decision governance includes recommendation, why, supporting evidence, assumptions, uncertainty, alternatives considered, why alternatives lost, tradeoffs, expected outcome, success measure, and what would change the recommendation.
- Final recommendation includes action, why now, why this action, supporting evidence, uncertainty, alternatives considered, why alternatives lost, expected outcome, success measure, and what would change the recommendation.
- summarizeExecutiveJudgment includes highest-value action, decision needed, top risk, top opportunity, best next step, what can wait, what should not be done, escalation recommendation, readiness, and plain-language why.
- Action safety check verifies evidence support, current situation alignment, Reality Model consistency, prediction overclaim boundary, justified escalation, no-action consideration, missing evidence consideration, and report wording boundary.
- Tradeoff dimensions include speed_vs_quality, cost_vs_schedule, risk_vs_progress, evidence_vs_time, safety_vs_productivity, communication_vs_noise, short_term_vs_long_term, and escalation_vs_local_resolution.
- Tradeoff analysis identifies unnecessary noise risk and the least noisy option.
- Escalation analysis identifies triggers, target, timing, justification, evidence strength, evidence required before escalation, escalation risk, and whether local resolution should happen first.
- No-action and wait-for-evidence reasoning are valid Executive Judgment outputs, including weak evidence, resolving issues, noisy escalation, low impact, pending inspection result, one more evidence item, irreversible action, and low likely impact.
- PIECoreIntelligence exposes executiveJudgment, executiveJudgmentResult, executiveJudgmentExplanation, executiveJudgmentHighestValueAction, executiveDecisions, executiveJudgmentPriorities, executiveRisks, executiveOpportunities, executiveConstraints, tradeoffAnalysis, escalationAnalysis, opportunityCost, decisionTiming, noActionReasoning, waitForEvidenceReasoning, actionSafetyCheck, executiveJudgmentReadiness, executiveJudgmentSummary, bestNextStep, whatCanWait, whatNotToDo, decisionNeeded, escalationRecommendation, recommendationReadiness, recommendationWhy, recommendationAlternatives, and recommendationSuccessMeasure.
- executiveJudgmentExplanation answers what matters most, what decision is needed, what creates the greatest value, what reduces uncertainty, what reduces risk, what can wait, what should be escalated, what should not be escalated, the best action if evidence is incomplete, and when no action is correct.
- Attention prioritizes highest-value executive actions without over-prioritizing low-value escalation.
- Attention uses bestNextStep.
- Experience guides the user to bestNextStep and requests evidence when wait-for-evidence is best.
- Reporter uses Executive Judgment summary, recommendationWhy, and decisionNeeded without exposing internal scoring data.
- Reporter avoids unjustified escalation and avoids fake action items when monitoring or no_action is best.
- Executive Judgment requires authoritative Reality Model metadata, including model ID, model version, snapshot ID, evidence cutoff, active conflict IDs, and active uncertainty IDs.
- Executive Judgment authority carries Reality persistence status so downstream automation can block stale, conflict-blocked, or failed persistence states.
- Executive Judgment records are persisted as immutable structured records before Layer 4 creates decision candidates.
- Executive Judgment persistence includes Reality Model ID/version, snapshot ID, situation summary, primary recommendation, alternatives, tradeoffs, risks, constraints, authority requirement, no-action option, confidence, uncertainty, supporting Reality Object IDs, supporting assertion IDs, active conflicts, active uncertainties, and conditions that would change the recommendation.
- Reporter live communication must use a persisted Executive Judgment record and must not independently determine recommendation, priority, escalation, owner, or next best action.
- Layer 4 live decision candidates must be created from persisted Executive Judgment records, not report text, UI draft state, or raw evidence arrays.
- Layer 4 high-impact decision automation is blocked when Reality persistence status is stale_model, persistence_failed, conflict_blocked, blocked_identity, or blocked_organization.
- Traceability must connect user-visible recommendations to Executive Judgment ID, Reality Model version, snapshot ID, Reality Objects, assertions, evidence, conflicts, and uncertainties.
- Layer 3 answers the test questions: highest-value action, decision needed, what can wait, what should be escalated, what should not be escalated, tradeoffs considered, why alternatives lost, what would change the recommendation, and how success is measured.
- Docs define Layer 3 as Executive Judgment.

## PIE Adaptive Intelligence QA

JARVIS must verify:

- PIEAdaptiveIntelligence service exists.
- Adaptive Intelligence types include PIEAdaptiveIntelligence, PIEAdaptiveResult, PIEOutcomeIntelligence, PIECalibrationIntelligence, PIELearningIntelligence, PIEStrategyIntelligence, PIECommunicationIntelligence, PIETrustIntelligence, PIEEvolutionIntelligence, PIEAdaptivePolicy, PIEConstitutionalPrinciple, PIEAdaptiveLesson, and PIEAdaptiveAdjustment.
- Functions include buildPIEAdaptiveIntelligence, evaluateDecisionOutcome, evaluateRecommendationOutcome, calibrateConfidenceFromOutcome, extractAdaptiveLessons, updateAdaptivePolicies, evaluateCommunicationEffectiveness, evaluatePIETrustInSituation, recommendStrategyAdjustment, protectConstitutionalPrinciples, and summarizeAdaptiveIntelligence.
- Outcome intelligence evaluates whether recommendations were confirmed, contradicted, accepted, rejected, modified, or affected by reality changes.
- Calibration intelligence evaluates whether confidence was too high, too low, or should hold.
- Strategy intelligence, communication intelligence, trust intelligence, and evolution intelligence exist.
- Constitutional learning separates permanent principles from adaptive policies.
- Adaptive policies include preferred report style, preferred evidence sequence, escalation threshold, risk threshold, confidence calibration, user communication style, and inspection readiness threshold.
- PIECoreIntelligence exposes adaptiveIntelligence, outcomeIntelligence, calibrationIntelligence, strategyAdjustments, communicationAdjustments, trustAssessment, adaptiveLessons, and adaptivePolicyUpdates.
- Executive Judgment consumes adaptive policies where practical.
- Docs define Layer 4 as Adaptive Intelligence.

## PIE Decision Memory QA

JARVIS must verify:

- PIEDecisionMemory service exists.
- Types include PIEDecisionMemory, PIEDecisionRecord, PIERecommendationRecord, PIEDecisionOutcomeRecord, PIEExecutiveWisdomLesson, PIEWisdomPattern, PIEWhenNotToActReason, PIETrustCalibrationRecord, PIEDecisionMemoryResult, and PIEWisdomRecommendation.
- Functions include buildPIEDecisionMemory, recordDecision, recordRecommendation, recordDecisionOutcome, compareDecisionToOutcome, extractWisdomLessons, identifyWhenNotToAct, identifyRepeatedDecisionPatterns, buildWisdomRecommendation, calibrateTrustFromDecisionHistory, and summarizeDecisionMemory.
- Decision records include recommendation made, why it was made, evidence used, assumptions, alternatives considered, uncertainty, user action, actual outcome, recommendation correctness, impact, lesson learned, and future adjustment.
- When-not-to-act reasoning includes evidence too weak, issue already resolving, escalation creates unnecessary noise, waiting reduces risk, action irreversible, decision impact low, user correction history suggests caution, prediction confidence low, and truth over speed.
- Decision Memory feeds Adaptive Intelligence, Learning, Reflection, and Memory Recall.
- PIECoreIntelligence exposes decisionMemory, decisionHistory, wisdomLessons, whenNotToActReasons, wisdomRecommendations, and trustCalibrationHistory.
- Executive Judgment consumes Decision Memory before recommending action.
- Reporter, Attention, and Experience respect wisdom outputs.

## PIE Layer 4 Trusted History Foundation QA

JARVIS must verify:

- PIELayer4Identity exists and is the centralized actor-building service.
- Layer 4 uses Supabase authenticated user ID when available.
- Layer 4 resolves active organization membership from `organization_memberships`.
- Layer 4 membership roles are limited to member, project_manager, decision_owner, validation_authority, and organization_admin.
- Layer 4 membership status is limited to active, invited, suspended, and removed.
- Layer 4 clearly separates authenticated identity from offline fallback identity.
- Offline fallback identities are not cloud trusted.
- Protected cloud actions fail closed when organization membership cannot be verified.
- Protected cloud actions require active membership and the specific required permission.
- PIELayer4Permission exists with permissions for viewing history, creating snapshots, approving, rejecting, deferring, implementing, cancelling, recording outcome plans, recording implementation assessment, recording outcomes, validating, disputing, closing, and appending versions.
- Decision ledger domain functions enforce permissions, not only UI visibility.
- Decision ledger local storage is organization-scoped and versioned.
- Legacy global decision ledger records are quarantined instead of silently assigned to the current organization.
- Decision ledger sync exposes local_only, queued, syncing, synced, conflict, failed, identity_unavailable, and organization_unavailable states.
- Decision ledger sync requires `synchronize_decision_history` permission.
- Decision ledger sync detects immutable snapshot, version, audit, outcome, validation, and stale-closed conflicts.
- Decision ledger sync uses an atomic Supabase RPC boundary instead of non-transactional multi-table client upserts.
- The atomic Supabase RPC boundary verifies authenticated user, active organization membership, actor identity, organization boundary, append-only versions, outcome history, audit history, and validation authority.
- RLS is enabled on organizations, organization_memberships, pie_decision_records, pie_decision_versions, pie_decision_outcomes, and pie_decision_audit_events.
- RLS policies are organization-scoped and not permissive.
- If no membership schema exists, Layer 4 database access remains fail-closed and the missing schema is reported.
- Database protections prevent replacing original snapshots, editing append-only versions, editing audit events, editing outcome history, deleting history, and crossing parent-child organization/project boundaries.
- Review UI displays whether decision history is local-only, queued, synced, failed, conflicted, or identity unavailable.
- Review UI follows review-by-exception: routine status management is hidden from the normal workflow.
- Review UI does not expose Record Decision Snapshot, Record Implementation Quality, Record Actual Outcome, or Close Decision as normal user actions.
- Review UI keeps concise actions for approve, reject, defer, correct, this-is-not-a-decision, and outcome-not-achieved.
- PIE automatically links existing photos, updates, schedule items, and documents when they are relevant and inside the same organization/project boundary.
- Layer 4 evidence references include evidence ID, evidence type, organization ID, project ID, created/captured time, and version or hash markers when available.
- Cross-organization and cross-project evidence references are rejected by the decision ledger service.
- Validation and dispute actions preserve outcome history by appending a validation history entry instead of replacing the observed outcome.
- Tests cover permission denial, organization-scoped storage, legacy quarantine, idempotent queueing, cloud-trust failure, and immutable sync conflicts.
- Static migration tests cover the membership/RLS/atomic RPC contract.
- Real Supabase RLS execution must be run against local or test Supabase before claiming database isolation has passed at runtime.

## PIE Layer 4 Automation Foundation QA

JARVIS must verify:

- PIELayer4Automation exists.
- Meaningful Layer 3 recommendations create decision candidates automatically.
- Casual notes, incomplete drafts, low-confidence interpretations, duplicate recommendations, and informational summaries do not create permanent decision records.
- Predicted outcomes are generated from recommendation context, objectives, schedule signals, risk mitigations, owner assignments, and project context.
- Outcome plans are generated automatically when decisions are approved or implemented.
- Existing project evidence is collected and linked automatically.
- Routine lifecycle transitions use the same validated decision-ledger domain functions as manual actions.
- Automation uses three levels: automatic, confirmation_required, and human_decision_required.
- Safety, compliance, legal, capital, personnel-sensitive, irreversible, disputed, and high-impact decisions require human authority.
- Automatic actions create audit records with action taken, trigger, evidence, confidence, automation level, approval reason, correction availability, reversibility, and timestamp.
- Implementation fidelity is proposed from evidence and kept separate from outcome quality.
- Predicted and actual outcomes are compared automatically without claiming causation from weak evidence.
- Conflicting evidence creates an exception instead of silent automation.
- User corrections preserve original decision history by appending versions or audit events.
- Low-confidence automation is blocked or requires confirmation.

## PIE Decision Intelligence Advancement QA

JARVIS must verify:

- PIEDecisionSimulation exists and consumes Reality Model, Executive Judgment context, Missing Evidence, Predictive Reality, and Decision Ledger provenance instead of raw UI state.
- Decision simulation generates recommended action, credible alternative, no-action, delay-and-gather-evidence, and escalation options when relevant.
- Simulation scenarios include expected, best, worst, evidence-deficient, delay, execution-failure, incomplete-implementation, and visual-progress-versus-written-status conflict paths.
- Option scoring includes schedule impact, cost impact, risk reduction, safety impact, confidence, reversibility, implementation difficulty, evidence completeness, authority required, and user burden.
- Simulation scores include weights, evidence, assumptions, uncertainty penalty, confidence adjustment, and plain-language explanation.
- Safety and compliance operate as gates and cannot be overridden by weighted scores.
- Sensitivity analysis identifies which assumptions could change the recommendation and classifies robustness, including cost, duration, resources, evidence confidence, risk likelihood/severity, implementation quality, deadline, stakeholder availability, schedule deadlines, photo-progress interpretation, and regulatory interpretation.
- Recommendation Challenge exists and tests the strongest argument against the preferred recommendation, disconfirming evidence, dependencies, implementation failure, no-action, delay, authority, confidence overstatement, visual evidence overinterpretation, and whether a different reasonable assumption changes the answer.
- JARVIS reasoning validation uses rule-based statuses: pass, pass_with_warnings, needs_more_evidence, human_review_required, and blocked.
- JARVIS validates reality authority, traceability, fact support, conflicts, option completeness, tradeoffs, no-action, reproducibility, sensitivity, authority boundaries, robustness, photo-evidence interpretation, causal reasoning, challenge completeness, and summary consistency.
- Confidence decomposition separates evidence quality, Reality Model quality, identity trust, causal strength, forecast reliability, option comparison, execution uncertainty, outcome measurement uncertainty, and overall recommendation confidence.
- Evidence value prioritization identifies the single highest-value evidence request needed to reduce uncertainty.
- Predictive Reality forecasts include predicted event, timeframe, assumptions, leading indicators, probability/confidence, supporting object IDs, risks that could alter the forecast, reassessment trigger, expected confirming evidence, and prior forecasts for calibration.
- PIECoreIntelligence exposes decision simulation, recommendation challenge, JARVIS reasoning validation, confidence decomposition, evidence value prioritization, and decision provenance, including photo progress event IDs used by the simulation.
- PIELiveAuthorityProvider blocks high-impact automation and Layer 4 decision creation when JARVIS validation requires more evidence, human review, or is blocked.
- Review automation respects the live authority policy before creating decision snapshots.
- Normal UI does not expose buttons or screens for internal simulation, recommendation challenge, JARVIS reasoning validation, or confidence decomposition.

## Longitudinal Photo Intelligence QA

JARVIS must verify:

- PIEPhotoProgressIntelligence exists.
- Photos are grouped into stable PhotoSequence records by organization, project, building, area/room, Reality Object, subject, approximate viewpoint, and capture date.
- Photos are not compared merely because they belong to the same project.
- Comparability is classified as strong_match, probable_match, weak_match, or not_comparable.
- Weak or non-comparable images do not produce confident progress claims.
- Normalization operations are recorded without modifying original photographs.
- PhotoProgressEvent records include organization, project, sequence, earlier/later photo IDs, dates, observation, inferred meaning, progress category, progress direction, confidence, comparability score, supporting regions, limitations, corroborating evidence, contradicting evidence, schedule/action links, review status, and created time.
- Observation, inference, and verification status are separated.
- Completion claims require corroborating evidence.
- Regression claims require JARVIS or human validation.
- Visual progress is compared with schedule items, action items, issues, reports, and expected Reality state without silently assuming either photo or written record is correct.
- Stalled progress is identified with the limitation that work may have occurred outside the photographed area.
- Duplicate photos do not create progress events.
- Wrong-project photos are rejected from sequences.
- Photo progress enters Reality only as qualified visual evidence through the established Reality synchronization path.
- Core exposes longitudinalPhotoIntelligence, photoSequences, photoProgressEvents, photoProgressConflicts, photoRepeatGuidance, and visualJarvisValidation.
- Capture may show repeat-photo guidance only when useful.
- Normal UI does not expose Compare Photos, Analyze Progress, Run Visual Review, Calculate Progress, or Validate Image controls.

Required commands:

- npm run test:photo-sequences
- npm run test:photo-comparison
- npm run test:photo-progress
- npm run test:visual-jarvis
- npm run test:repeat-photo-guidance
- npm run test:photo-progress-ui

## Multimodal Evidence and True Photo Intelligence QA

JARVIS must verify the backend-safe foundation for multimodal evidence and raw-photo intelligence.

Required:

- `services/PIEPhotoVisionMobileWorkflow.ts` and `services/PIEPhotoProgressIntelligence.ts` own the live mobile photo path.
- `docs/PIE_MultimodalEvidenceArchitecture.md` exists.
- `docs/PIE_TruePhotoIntelligence.md` exists.
- `docs/PIE_VisualValidationPlan.md` exists.
- `supabase/migrations/20260702030000_multimodal_evidence_foundation.sql` exists.
- `supabase/functions/pie-photo-vision/index.ts` exists.
- The Edge Function returns structured visual observations, comparison findings, confidence, limitations, authority, and comparability.
- Photo analysis authority remains `visual_observation_only`.
- JARVIS rejects hidden-work, code-compliance, causation, responsibility, inspection-pass, exact-progress, and non-comparable-change claims.
- The Supabase bucket is private and organization/project scoped.
- RLS is enabled on evidence, photo asset, analysis, visual JARVIS, and correction tables.
- Raw-pixel provider calls live only in the Edge Function.
- Provider API key names do not appear in mobile app code.
- Missing provider configuration produces degraded or failed processing, not fake success.
- Documentation clearly states current authorization is organization membership plus project identity and parent-child project consistency, not true per-project user authorization.
- Baseline failure case 001, `mouse_added_to_table`, is recorded as a failed Build 21 physical-device case and required True Photo Intelligence acceptance case.
- The mouse baseline case requires exact hashes, perceptual hashes, scene/viewpoint similarity, raw-pixel semantic comparison, object_added detection, persisted comparison, and explicit prevention of project-progress wording.
- Production vision pipeline requires a provider-neutral server interface, Supabase Edge Function boundary, request persistence, comparison persistence, JARVIS persistence, timeout/retry/degraded behavior, and mobile pending/complete/degraded/hydration/correction state helpers.
- Production coverage exists for photo authority, longitudinal comparison, and adversarial visual validation.

Required commands:

- npm run test:photo-vision-authority
- npm run test:photo-comparison
- npm run test:visual-jarvis
