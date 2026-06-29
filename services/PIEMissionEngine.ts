import type {
  PIEDecision,
  PIEDecisionPriority,
  PIEDecisionQueue,
} from './PIEDecisionEngine';
import type {
  PIEExecutiveBrief,
} from './PIEExecutive';
import type {
  PIEGraph,
  PIEGraphGap,
  PIEGraphRelationship,
} from './PIEKnowledgeGraph';
import type { PIEMemorySnapshot } from './PIEMemoryEngine';
import type {
  PIEReflectionResult,
} from './PIEReflectionEngine';
import type {
  ProjectConfidenceLevel,
  ProjectIntelligenceSummary,
} from './ProjectIntelligenceEngine';
import type { ProjectEvent } from './ProjectEventService';
import type { PIERuntimeState } from './PIERuntime';

export type PIEMissionType =
  | 'morning-brief'
  | 'project-walk'
  | 'executive-meeting-prep'
  | 'customer-update-prep'
  | 'inspection-verification'
  | 'reduce-project-uncertainty'
  | 'close-critical-risks'
  | 'safety-verification'
  | 'issue-investigation'
  | 'schedule-recovery'
  | 'communication-preparation'
  | 'documentation-completion'
  | 'monitoring';

export type PIEMissionStatus =
  | 'not-started'
  | 'active'
  | 'blocked'
  | 'ready-for-approval'
  | 'complete'
  | 'monitoring';

export type PIEMissionSource =
  | 'pie-runtime'
  | 'pie-executive'
  | 'pie-reflection'
  | 'pie-behavior'
  | 'pie-decision'
  | 'pie-memory'
  | 'pie-knowledge-graph'
  | 'project-event'
  | 'project-intelligence'
  | 'mission-engine';

export type PIEMissionObjective = {
  id: string;
  missionType: PIEMissionType;
  title: string;
  summary: string;
  desiredOutcome: string;
  priority: PIEDecisionPriority;
};

export type PIEMissionEvidence = {
  id: string;
  title: string;
  detail: string;
  source: PIEMissionSource;
  confidence: ProjectConfidenceLevel;
  occurredAt: string | null;
  relatedRecordId: string | null;
};

export type PIEMissionBlocker = {
  id: string;
  title: string;
  summary: string;
  source: PIEMissionSource;
  priority: PIEDecisionPriority;
  confidence: ProjectConfidenceLevel;
  evidence: string[];
  suggestedAction: string;
  blocksMission: boolean;
};

export type PIEMissionSuccessCriteria = {
  id: string;
  description: string;
  met: boolean;
  required: boolean;
  evidence: string[];
  confidence: ProjectConfidenceLevel;
};

export type PIEMissionProgress = {
  score: number;
  status: PIEMissionStatus;
  summary: string;
  completedCriteria: string[];
  remainingCriteria: string[];
};

export type PIEMissionTransition = {
  fromMission: PIEMissionType;
  toMission: PIEMissionType;
  reason: string;
  condition: string;
  confidence: ProjectConfidenceLevel;
};

export type PIEMissionRecommendation = {
  id: string;
  missionType: PIEMissionType;
  title: string;
  recommendation: string;
  why: string;
  evidence: string[];
  confidence: ProjectConfidenceLevel;
  priority: PIEDecisionPriority;
  expectedImpact: string;
  userApprovalRequired: boolean;
  source: PIEMissionSource;
};

export type PIEMission = {
  id: string;
  projectName: string;
  missionType: PIEMissionType;
  title: string;
  purpose: string;
  whyThisMissionExists: string;
  objective: PIEMissionObjective;
  status: PIEMissionStatus;
  progress: PIEMissionProgress;
  evidenceCollected: PIEMissionEvidence[];
  evidenceStillNeeded: string[];
  blockers: PIEMissionBlocker[];
  priority: PIEDecisionPriority;
  confidence: ProjectConfidenceLevel;
  trust: ProjectConfidenceLevel;
  expectedImpact: string;
  recommendedActions: PIEMissionRecommendation[];
  successCriteria: PIEMissionSuccessCriteria[];
  userApprovalsRequired: string[];
  nextMission: PIEMissionTransition | null;
  transitions: PIEMissionTransition[];
  generatedAt: string;
  sources: PIEMissionSource[];
};

export type PIEMissionSummary = {
  id: string;
  generatedAt: string;
  projectName: string;
  currentMission: PIEMission;
  dailyMission: PIEMission;
  projectMission: PIEMission;
  missionCount: number;
  overallPurpose: string;
  nextMission: PIEMissionTransition | null;
  activeBlockers: PIEMissionBlocker[];
  recommendedActions: PIEMissionRecommendation[];
  confidence: ProjectConfidenceLevel;
};

export type PIEMissionBehaviorSnapshot = {
  state?: string | null;
  attentionScore?: number | null;
  attentionLevel?: PIEDecisionPriority | 'low' | 'medium' | 'high' | 'critical' | null;
  activeRecommendation?: {
    recommendation?: string;
    why?: string;
    confidence?: ProjectConfidenceLevel;
    urgency?: PIEDecisionPriority;
    evidence?: string[];
    userApprovalRequired?: boolean;
    expectedImpact?: string;
  } | null;
  questions?: Array<{
    question: string;
    reason?: string;
    confidence?: ProjectConfidenceLevel;
    priority?: PIEDecisionPriority;
    evidence?: string[];
  }>;
  escalations?: Array<{
    title: string;
    summary?: string;
    confidence?: ProjectConfidenceLevel;
    priority?: PIEDecisionPriority;
    evidence?: string[];
    suggestedAction?: string;
  }>;
};

export type BuildPIEMissionParams = {
  missionType?: PIEMissionType | null;
  projectName?: string | null;
  runtime?: PIERuntimeState | null;
  runtimes?: PIERuntimeState[];
  executiveBrief?: PIEExecutiveBrief | null;
  reflection?: PIEReflectionResult | null;
  behavior?: PIEMissionBehaviorSnapshot | null;
  decisionQueue?: PIEDecisionQueue | null;
  memory?: PIEMemorySnapshot | null;
  knowledgeGraph?: PIEGraph | null;
  projectEvents?: ProjectEvent[];
  intelligence?: ProjectIntelligenceSummary | null;
  now?: Date;
};

type MissionInput = PIEMission | BuildPIEMissionParams;

type MissionDefinition = {
  title: string;
  purpose: string;
  objectiveTitle: string;
  objectiveSummary: string;
  desiredOutcome: string;
  expectedImpact: string;
  defaultPriority: PIEDecisionPriority;
  nextMission: PIEMissionType | null;
  criteria: string[];
};

type MissionContext = {
  projectName: string;
  generatedAt: string;
  missionType: PIEMissionType;
  runtime: PIERuntimeState | null;
  runtimes: PIERuntimeState[];
  executiveBrief: PIEExecutiveBrief | null;
  reflection: PIEReflectionResult | null;
  behavior: PIEMissionBehaviorSnapshot | null;
  decisionQueue: PIEDecisionQueue | null;
  memory: PIEMemorySnapshot | null;
  knowledgeGraph: PIEGraph | null;
  projectEvents: ProjectEvent[];
  intelligence: ProjectIntelligenceSummary | null;
};

const MISSION_DEFINITIONS: Record<PIEMissionType, MissionDefinition> = {
  'morning-brief': {
    title: 'Morning Brief',
    purpose: 'Start the day with the clearest project-management priority.',
    objectiveTitle: 'Review what deserves attention today',
    objectiveSummary:
      'Identify the top priority, what changed, what PIE needs from the user, and which project should be reviewed first.',
    desiredOutcome:
      'The user starts with a clear, evidence-backed plan for the day.',
    expectedImpact:
      'Reduces morning uncertainty and prevents the user from scanning raw project data manually.',
    defaultPriority: 'medium',
    nextMission: 'project-walk',
    criteria: [
      'Top priority is identified.',
      'Projects needing attention are reviewed.',
      'Questions or approvals needed from the user are visible.',
    ],
  },
  'project-walk': {
    title: 'Project Walk',
    purpose:
      'Guide the user through the field evidence PIE most needs to improve project reality.',
    objectiveTitle: 'Verify current field reality',
    objectiveSummary:
      'Confirm project, area, current work status, risks, and missing evidence while the user is in the field.',
    desiredOutcome:
      'PIE receives current, user-verified evidence that strengthens project understanding.',
    expectedImpact:
      'Improves field accuracy, location confidence, photo coverage, and next-action quality.',
    defaultPriority: 'high',
    nextMission: 'inspection-verification',
    criteria: [
      'Project and area context are confirmed or corrected.',
      'Current progress evidence is captured or reviewed.',
      'Open field questions are answered.',
    ],
  },
  'executive-meeting-prep': {
    title: 'Executive Meeting Prep',
    purpose:
      'Prepare executive-level priorities, decisions, escalations, and status with evidence.',
    objectiveTitle: 'Prepare the executive view',
    objectiveSummary:
      'Clarify what leadership needs to know, what decisions need approval, and what risks need attention.',
    desiredOutcome:
      'The user can enter an executive discussion with concise, evidence-backed talking points.',
    expectedImpact:
      'Improves leadership communication and reduces unprepared decision discussions.',
    defaultPriority: 'high',
    nextMission: 'customer-update-prep',
    criteria: [
      'Executive priority is clear.',
      'Decision or escalation items are identified.',
      'Evidence and uncertainty are available for review.',
    ],
  },
  'customer-update-prep': {
    title: 'Customer Update Prep',
    purpose:
      'Prepare accurate customer-facing communication without overstating certainty.',
    objectiveTitle: 'Prepare customer communication',
    objectiveSummary:
      'Gather current status, risks, evidence, caveats, and next steps for user-approved customer communication.',
    desiredOutcome:
      'The customer update is useful, accurate, and ready for user review.',
    expectedImpact:
      'Improves customer confidence while preserving review-and-approve boundaries.',
    defaultPriority: 'high',
    nextMission: 'monitoring',
    criteria: [
      'Customer-facing status is supported by evidence.',
      'Missing context or caveats are visible.',
      'User approval is required before communication is sent.',
    ],
  },
  'inspection-verification': {
    title: 'Inspection Verification',
    purpose:
      'Confirm inspection status before PIE treats work as complete or communication-ready.',
    objectiveTitle: 'Verify inspection status',
    objectiveSummary:
      'Identify whether inspection evidence exists, what is missing, and what the user should verify first.',
    desiredOutcome:
      'Inspection status is confirmed, corrected, or clearly marked unknown.',
    expectedImpact:
      'Reduces risk of communicating completion without inspection support.',
    defaultPriority: 'high',
    nextMission: 'executive-meeting-prep',
    criteria: [
      'Inspection status is known or explicitly marked unknown.',
      'Related schedule or field evidence is reviewed.',
      'Communication avoids unsupported completion claims.',
    ],
  },
  'reduce-project-uncertainty': {
    title: 'Reduce Project Uncertainty',
    purpose:
      'Collect the evidence that most improves PIE trust, understanding, and confidence.',
    objectiveTitle: 'Improve project understanding',
    objectiveSummary:
      'Focus on missing updates, photos, schedule, documents, inspections, relationships, or answers that are limiting PIE.',
    desiredOutcome:
      'PIE knows what evidence is missing and what the user should verify first.',
    expectedImpact:
      'Raises trust and understanding before decisions or communication are prepared.',
    defaultPriority: 'medium',
    nextMission: 'project-walk',
    criteria: [
      'Missing evidence is identified.',
      'The highest-value verification question is clear.',
      'Trust and understanding blockers are visible.',
    ],
  },
  'close-critical-risks': {
    title: 'Close Critical Risks',
    purpose:
      'Focus user attention on high-impact risk, blocker, safety, or approval items.',
    objectiveTitle: 'Resolve or contain critical risk',
    objectiveSummary:
      'Identify the strongest risk evidence, owner or missing owner, impact, and required user action.',
    desiredOutcome:
      'The user knows which critical risk to review and what decision or evidence is needed.',
    expectedImpact:
      'Reduces safety, schedule, stakeholder, and project-control exposure.',
    defaultPriority: 'critical',
    nextMission: 'executive-meeting-prep',
    criteria: [
      'Critical risk is identified.',
      'Impact and evidence are visible.',
      'User approval or decision requirement is clear.',
    ],
  },
  'safety-verification': {
    title: 'Safety Verification',
    purpose:
      'Verify open safety concerns before routine project-management work continues.',
    objectiveTitle: 'Review safety status',
    objectiveSummary:
      'Confirm safety evidence, corrective action, owner, status, and escalation need.',
    desiredOutcome:
      'Safety status is verified or escalated for user action.',
    expectedImpact:
      'Keeps safety concerns from being buried beneath routine progress work.',
    defaultPriority: 'critical',
    nextMission: 'close-critical-risks',
    criteria: [
      'Safety concern evidence is reviewed.',
      'Corrective action or missing owner is identified.',
      'User approval boundary is preserved.',
    ],
  },
  'issue-investigation': {
    title: 'Issue Investigation',
    purpose:
      'Connect issue evidence to area, owner, schedule impact, documents, and decisions.',
    objectiveTitle: 'Investigate the open issue',
    objectiveSummary:
      'Determine what the issue affects, what evidence supports it, who owns it, and what action is needed.',
    desiredOutcome:
      'The issue is clear enough for the user to assign, escalate, defer, or close after review.',
    expectedImpact:
      'Improves issue clarity and prevents disconnected follow-up.',
    defaultPriority: 'high',
    nextMission: 'schedule-recovery',
    criteria: [
      'Issue evidence is connected.',
      'Owner or missing owner is visible.',
      'Schedule or communication impact is understood.',
    ],
  },
  'schedule-recovery': {
    title: 'Schedule Recovery',
    purpose:
      'Recover attention on overdue, blocked, waiting, or high-priority schedule work.',
    objectiveTitle: 'Recover schedule control',
    objectiveSummary:
      'Identify overdue work, blockers, dependencies, missing owners, and next recovery action.',
    desiredOutcome:
      'The user knows which schedule item to review first and why.',
    expectedImpact:
      'Reduces schedule drift and clarifies recovery action.',
    defaultPriority: 'high',
    nextMission: 'communication-preparation',
    criteria: [
      'Overdue or blocked schedule work is identified.',
      'Evidence and owner context are reviewed.',
      'Recovery action is prepared for user approval.',
    ],
  },
  'communication-preparation': {
    title: 'Communication Preparation',
    purpose:
      'Prepare stakeholder communication after PIE checks evidence, uncertainty, and approval needs.',
    objectiveTitle: 'Prepare accurate communication',
    objectiveSummary:
      'Gather project status, changes, concerns, recommended language, missing context, and approval requirements.',
    desiredOutcome:
      'Communication is ready for review, edit, and approval.',
    expectedImpact:
      'Reduces retyping and improves accuracy in stakeholder updates.',
    defaultPriority: 'medium',
    nextMission: 'monitoring',
    criteria: [
      'Audience and purpose are clear.',
      'Status and risks are evidence-backed.',
      'User approval is required before sending.',
    ],
  },
  'documentation-completion': {
    title: 'Documentation Completion',
    purpose:
      'Fill missing project documentation needed for confidence, reports, or decisions.',
    objectiveTitle: 'Complete missing documentation',
    objectiveSummary:
      'Identify missing reports, documents, photos, updates, inspection records, or decision records.',
    desiredOutcome:
      'The user knows what documentation would most improve PIE confidence.',
    expectedImpact:
      'Improves traceability, report readiness, and future project memory.',
    defaultPriority: 'medium',
    nextMission: 'monitoring',
    criteria: [
      'Missing documentation is identified.',
      'Impact of missing documentation is clear.',
      'Next documentation action is recommended.',
    ],
  },
  monitoring: {
    title: 'Monitoring',
    purpose:
      'Stay quiet while PIE continues tracking evidence, risks, and changes.',
    objectiveTitle: 'Monitor project state',
    objectiveSummary:
      'Continue watching for meaningful change without creating unnecessary user work.',
    desiredOutcome:
      'PIE remains ready without interrupting the user unnecessarily.',
    expectedImpact:
      'Protects user attention while preserving current project awareness.',
    defaultPriority: 'low',
    nextMission: null,
    criteria: [
      'No urgent mission is currently supported by evidence.',
      'PIE continues monitoring available signals.',
      'User approval boundaries remain preserved.',
    ],
  },
};

export function buildMission(
  params: BuildPIEMissionParams = {},
): PIEMission {
  const context = buildMissionContext(params);
  const definition = MISSION_DEFINITIONS[context.missionType];
  const evidenceCollected = collectMissionEvidence(context);
  const evidenceStillNeeded = collectMissionEvidenceNeeds(context);
  const blockers = collectMissionBlockers(context);
  const recommendedActions = buildMissionRecommendationsFromContext(
    context,
    definition,
    evidenceCollected,
    blockers,
  );
  const successCriteria = buildMissionSuccessCriteria(
    context,
    definition,
    evidenceCollected,
    evidenceStillNeeded,
    blockers,
  );
  const progress = buildMissionProgress(successCriteria, blockers);
  const status = progress.status;
  const priority = missionPriority(context, definition, blockers, recommendedActions);
  const confidence = missionConfidence(context, evidenceCollected, blockers);
  const trust = missionTrust(context, confidence);
  const transitions = buildMissionTransitions(context, progress, blockers);
  const nextMission = getNextTransition(context.missionType, transitions);

  return {
    id: `pie-mission:${context.missionType}:${slug(context.projectName)}:${context.generatedAt}`,
    projectName: context.projectName,
    missionType: context.missionType,
    title: definition.title,
    purpose: definition.purpose,
    whyThisMissionExists: missionReason(context, definition, blockers),
    objective: {
      id: `objective:${context.missionType}`,
      missionType: context.missionType,
      title: definition.objectiveTitle,
      summary: definition.objectiveSummary,
      desiredOutcome: definition.desiredOutcome,
      priority,
    },
    status,
    progress,
    evidenceCollected,
    evidenceStillNeeded,
    blockers,
    priority,
    confidence,
    trust,
    expectedImpact: definition.expectedImpact,
    recommendedActions,
    successCriteria,
    userApprovalsRequired: approvalRequirements(context, recommendedActions),
    nextMission,
    transitions,
    generatedAt: context.generatedAt,
    sources: missionSources(context),
  };
}

export function buildDailyMission(
  params: BuildPIEMissionParams = {},
): PIEMission {
  return buildMission({
    ...params,
    missionType: params.missionType ?? dailyMissionType(params),
  });
}

export function buildProjectMission(
  params: BuildPIEMissionParams = {},
): PIEMission {
  return buildMission({
    ...params,
    missionType: params.missionType ?? projectMissionType(params),
  });
}

export function getMissionObjective(
  missionOrParams: MissionInput = {},
): PIEMissionObjective {
  return normalizeMission(missionOrParams).objective;
}

export function getMissionBlockers(
  missionOrParams: MissionInput = {},
): PIEMissionBlocker[] {
  return normalizeMission(missionOrParams).blockers;
}

export function getMissionEvidence(
  missionOrParams: MissionInput = {},
): PIEMissionEvidence[] {
  return normalizeMission(missionOrParams).evidenceCollected;
}

export function getMissionRecommendations(
  missionOrParams: MissionInput = {},
): PIEMissionRecommendation[] {
  return normalizeMission(missionOrParams).recommendedActions;
}

export function getMissionSuccessCriteria(
  missionOrParams: MissionInput = {},
): PIEMissionSuccessCriteria[] {
  return normalizeMission(missionOrParams).successCriteria;
}

export function getMissionProgress(
  missionOrParams: MissionInput = {},
): PIEMissionProgress {
  return normalizeMission(missionOrParams).progress;
}

export function isMissionComplete(
  missionOrParams: MissionInput = {},
): boolean {
  return normalizeMission(missionOrParams).status === 'complete';
}

export function getNextMission(
  missionOrParams: MissionInput = {},
): PIEMissionTransition | null {
  return normalizeMission(missionOrParams).nextMission;
}

export function buildMissionSummary(
  params: BuildPIEMissionParams = {},
): PIEMissionSummary {
  const dailyMission = buildDailyMission(params);
  const projectMission = buildProjectMission(params);
  const currentMission = params.missionType
    ? buildMission(params)
    : projectMission.priority === 'critical' || projectMission.priority === 'high'
      ? projectMission
      : dailyMission;
  const activeBlockers = dedupeBlockers([
    ...dailyMission.blockers,
    ...projectMission.blockers,
    ...currentMission.blockers,
  ]);
  const recommendedActions = dedupeRecommendations([
    ...currentMission.recommendedActions,
    ...projectMission.recommendedActions,
    ...dailyMission.recommendedActions,
  ]);

  return {
    id: `pie-mission-summary:${slug(currentMission.projectName)}:${currentMission.generatedAt}`,
    generatedAt: currentMission.generatedAt,
    projectName: currentMission.projectName,
    currentMission,
    dailyMission,
    projectMission,
    missionCount: uniqueText([
      dailyMission.missionType,
      projectMission.missionType,
      currentMission.missionType,
    ]).length,
    overallPurpose:
      'Give PIE a clear purpose so recommendations, briefs, walks, reports, and questions all support the same project-management outcome.',
    nextMission: currentMission.nextMission,
    activeBlockers,
    recommendedActions,
    confidence: lowestConfidence([
      dailyMission.confidence,
      projectMission.confidence,
      currentMission.confidence,
    ]),
  };
}

function buildMissionContext(params: BuildPIEMissionParams): MissionContext {
  const runtime = params.runtime ?? params.runtimes?.[0] ?? null;
  const executiveBrief = params.executiveBrief ?? runtime?.pieExecutiveBrief ?? null;
  const reflection = params.reflection ?? null;
  const decisionQueue = params.decisionQueue ?? runtime?.decisionQueue ?? null;
  const memory = params.memory ?? runtime?.memory ?? null;
  const knowledgeGraph = params.knowledgeGraph ?? runtime?.knowledgeGraph ?? null;
  const intelligence = params.intelligence ?? runtime?.intelligence ?? null;
  const projectEvents = params.projectEvents ?? runtime?.projectEvents ?? [];
  const projectName =
    params.projectName?.trim() ||
    runtime?.projectName ||
    executiveBrief?.topPriority?.projectName ||
    decisionQueue?.projectName ||
    memory?.projectName ||
    knowledgeGraph?.projectName ||
    intelligence?.projectName ||
    projectEvents[0]?.projectName ||
    'Current Project';
  const generatedAt =
    runtime?.generatedAt ||
    executiveBrief?.generatedAt ||
    reflection?.generatedAt ||
    decisionQueue?.generatedAt ||
    memory?.generatedAt ||
    knowledgeGraph?.generatedAt ||
    intelligence?.generatedAt ||
    projectEvents[0]?.occurredAt ||
    (params.now ?? new Date()).toISOString();
  const contextWithoutMission = {
    projectName,
    generatedAt,
    runtime,
    runtimes: params.runtimes ?? (runtime ? [runtime] : []),
    executiveBrief,
    reflection,
    behavior: params.behavior ?? null,
    decisionQueue,
    memory,
    knowledgeGraph,
    projectEvents,
    intelligence,
  };
  const missionType = params.missionType ?? selectMissionType(contextWithoutMission);

  return {
    ...contextWithoutMission,
    missionType,
  };
}

function selectMissionType(
  context: Omit<MissionContext, 'missionType'>,
): PIEMissionType {
  const mode = context.executiveBrief?.operatingMode ||
    context.runtime?.recommendedOperatingMode;

  if (hasSafetySignal(context)) return 'safety-verification';
  if (hasCriticalRisk(context)) return 'close-critical-risks';
  if (hasInspectionNeed(context)) return 'inspection-verification';
  if (hasScheduleRecoveryNeed(context)) return 'schedule-recovery';
  if (mode === 'project_walk_prep' || context.decisionQueue?.projectWalkDecision) {
    return 'project-walk';
  }
  if (mode === 'executive_meeting_prep') return 'executive-meeting-prep';
  if (mode === 'customer_update_prep') return 'customer-update-prep';
  if (hasCommunicationNeed(context)) return 'communication-preparation';
  if (hasIssueInvestigationNeed(context)) return 'issue-investigation';
  if (hasDocumentationNeed(context)) return 'documentation-completion';
  if (hasUncertaintyNeed(context)) return 'reduce-project-uncertainty';
  if (mode === 'morning_brief') return 'morning-brief';

  return 'monitoring';
}

function dailyMissionType(params: BuildPIEMissionParams): PIEMissionType {
  const mode = params.executiveBrief?.operatingMode ||
    params.runtime?.recommendedOperatingMode;

  if (mode === 'end_of_day_review') return 'communication-preparation';
  if (mode === 'executive_meeting_prep') return 'executive-meeting-prep';
  if (mode === 'customer_update_prep') return 'customer-update-prep';

  return 'morning-brief';
}

function projectMissionType(params: BuildPIEMissionParams): PIEMissionType {
  return selectMissionType(buildMissionContext({
    ...params,
    missionType: 'monitoring',
  }));
}

function collectMissionEvidence(context: MissionContext): PIEMissionEvidence[] {
  const runtimeEvidence = [
    ...(context.runtime?.currentBeliefs ?? []).slice(0, 5).map(belief =>
      missionEvidence({
        id: `belief-${belief.id}`,
        title: 'Runtime Belief',
        detail: belief.statement,
        source: 'pie-runtime',
        confidence: belief.confidence,
        occurredAt: belief.createdAt,
        relatedRecordId: belief.id,
      }),
    ),
    ...(context.runtime?.recommendations ?? []).slice(0, 4).map(recommendation =>
      missionEvidence({
        id: `runtime-recommendation-${recommendation.id}`,
        title: recommendation.title,
        detail: recommendation.summary,
        source: 'pie-runtime',
        confidence: recommendation.confidence,
        occurredAt: context.generatedAt,
        relatedRecordId: recommendation.id,
      }),
    ),
  ];
  const executiveEvidence = [
    ...(context.executiveBrief?.rankedPriorities ?? []).slice(0, 5).map(priority =>
      missionEvidence({
        id: `executive-priority-${priority.id}`,
        title: priority.title,
        detail: priority.summary,
        source: 'pie-executive',
        confidence: priority.confidence,
        occurredAt: context.executiveBrief?.generatedAt ?? context.generatedAt,
        relatedRecordId: priority.id,
      }),
    ),
    ...(context.executiveBrief?.recommendations ?? []).slice(0, 4).map(item =>
      missionEvidence({
        id: `executive-recommendation-${item.id}`,
        title: item.recommendation,
        detail: item.why,
        source: 'pie-executive',
        confidence: item.confidence,
        occurredAt: context.executiveBrief?.generatedAt ?? context.generatedAt,
        relatedRecordId: item.id,
      }),
    ),
  ];
  const reflectionEvidence = [
    ...(context.reflection?.findings ?? []).slice(0, 4).map(finding =>
      missionEvidence({
        id: `reflection-finding-${finding.id}`,
        title: finding.title,
        detail: finding.summary,
        source: 'pie-reflection',
        confidence: finding.confidence,
        occurredAt: finding.createdAt,
        relatedRecordId: finding.id,
      }),
    ),
    ...(context.reflection?.verificationQuestions ?? []).slice(0, 4).map(question =>
      missionEvidence({
        id: `reflection-question-${question.id}`,
        title: 'Reflection Verification Question',
        detail: question.question,
        source: 'pie-reflection',
        confidence: question.confidence,
        occurredAt: context.reflection?.generatedAt ?? context.generatedAt,
        relatedRecordId: question.id,
      }),
    ),
  ];
  const decisionEvidence = (context.decisionQueue?.decisions ?? []).slice(0, 5).map(
    decision =>
      missionEvidence({
        id: `decision-${decision.id}`,
        title: decision.title,
        detail: decision.summary,
        source: 'pie-decision',
        confidence: decision.confidence,
        occurredAt: decision.createdAt,
        relatedRecordId: decision.id,
      }),
  );
  const memoryEvidence = [
    ...(context.memory?.insights ?? []).slice(0, 4).map(insight =>
      missionEvidence({
        id: `memory-insight-${insight.id}`,
        title: insight.title,
        detail: insight.summary,
        source: 'pie-memory',
        confidence: insight.confidence,
        occurredAt: context.memory?.generatedAt ?? context.generatedAt,
        relatedRecordId: insight.id,
      }),
    ),
    ...(context.memory ? [
      missionEvidence({
        id: 'memory-story',
        title: 'Project Story',
        detail: context.memory.story.whatHappened,
        source: 'pie-memory',
        confidence: context.memory.story.confidence,
        occurredAt: context.memory.generatedAt,
        relatedRecordId: null,
      }),
    ] : []),
  ];
  const graphEvidence = [
    ...(context.knowledgeGraph?.insights ?? []).slice(0, 4).map(insight =>
      missionEvidence({
        id: `graph-insight-${insight.id}`,
        title: insight.title,
        detail: insight.summary,
        source: 'pie-knowledge-graph',
        confidence: insight.confidence,
        occurredAt: context.knowledgeGraph?.generatedAt ?? context.generatedAt,
        relatedRecordId: insight.id,
      }),
    ),
    ...(context.knowledgeGraph?.relationships ?? [])
      .filter(relationship => relationship.edgeType === 'blocks')
      .slice(0, 3)
      .map(relationship =>
        missionEvidence({
          id: `graph-blocker-${relationship.id}`,
          title: 'Blocked Relationship',
          detail: relationship.summary,
          source: 'pie-knowledge-graph',
          confidence: relationship.confidence,
          occurredAt: context.knowledgeGraph?.generatedAt ?? context.generatedAt,
          relatedRecordId: relationship.id,
        }),
      ),
  ];
  const intelligenceEvidence = [
    ...(context.intelligence?.riskSignals ?? []).slice(0, 4).map(risk =>
      missionEvidence({
        id: `intelligence-risk-${risk.id}`,
        title: risk.label,
        detail: risk.message,
        source: 'project-intelligence',
        confidence: risk.confidence,
        occurredAt: context.intelligence?.generatedAt ?? context.generatedAt,
        relatedRecordId: risk.id,
      }),
    ),
    ...(context.intelligence ? [
      missionEvidence({
        id: 'intelligence-next-action',
        title: context.intelligence.recommendedNextAction.label,
        detail: context.intelligence.recommendedNextAction.description,
        source: 'project-intelligence',
        confidence: context.intelligence.recommendedNextAction.confidence,
        occurredAt: context.intelligence.generatedAt,
        relatedRecordId: context.intelligence.recommendedNextAction.id,
      }),
    ] : []),
  ];
  const eventEvidence = context.projectEvents.slice(0, 6).map(event =>
    missionEvidence({
      id: `event-${event.id}`,
      title: event.title,
      detail: event.description,
      source: 'project-event',
      confidence: event.confidence,
      occurredAt: event.occurredAt,
      relatedRecordId: event.id,
    }),
  );
  const behaviorEvidence = [
    ...(context.behavior?.activeRecommendation
      ? [
          missionEvidence({
            id: 'behavior-active-recommendation',
            title: 'Behavior Recommendation',
            detail: context.behavior.activeRecommendation.recommendation ||
              'PIE Behavior has an active recommendation.',
            source: 'pie-behavior',
            confidence:
              context.behavior.activeRecommendation.confidence ?? 'medium',
            occurredAt: context.generatedAt,
            relatedRecordId: null,
          }),
        ]
      : []),
    ...(context.behavior?.escalations ?? []).slice(0, 3).map((item, index) =>
      missionEvidence({
        id: `behavior-escalation-${index}`,
        title: item.title,
        detail: item.summary || item.suggestedAction || item.title,
        source: 'pie-behavior',
        confidence: item.confidence ?? 'medium',
        occurredAt: context.generatedAt,
        relatedRecordId: null,
      }),
    ),
  ];

  return dedupeEvidence([
    ...runtimeEvidence,
    ...executiveEvidence,
    ...reflectionEvidence,
    ...decisionEvidence,
    ...memoryEvidence,
    ...graphEvidence,
    ...intelligenceEvidence,
    ...eventEvidence,
    ...behaviorEvidence,
  ]);
}

function collectMissionEvidenceNeeds(context: MissionContext): string[] {
  const runtimeUnknowns = (context.runtime?.unknowns ?? []).map(unknown =>
    unknown.suggestedAction || unknown.summary,
  );
  const executiveQuestions = (context.executiveBrief?.questionsForUser ?? []).map(
    question => question.question,
  );
  const reflectionNeeds = [
    ...(context.reflection?.gaps ?? []).map(gap => gap.suggestedAction),
    ...(context.reflection?.verificationQuestions ?? []).map(
      question => question.question,
    ),
    context.reflection?.whatPIEShouldVerifyFirst,
  ];
  const memoryNeeds = (context.memory?.gaps ?? []).map(gap => gap.suggestedAction);
  const graphNeeds = (context.knowledgeGraph?.gaps ?? []).map(gap =>
    gap.suggestedAction,
  );
  const intelligenceNeeds = [
    ...(context.intelligence?.communicationReadiness.missingItems ?? []),
    context.intelligence?.photoCount === 0
      ? 'Capture current field photos.'
      : null,
    context.intelligence?.metrics.scheduleItemCount === 0
      ? 'Add or import schedule context.'
      : null,
    context.intelligence?.metrics.currentDocumentCount === 0
      ? 'Attach current document or specification context if relevant.'
      : null,
  ];

  return uniqueText([
    ...runtimeUnknowns,
    ...executiveQuestions,
    ...reflectionNeeds,
    ...memoryNeeds,
    ...graphNeeds,
    ...intelligenceNeeds,
  ]).slice(0, 10);
}

function collectMissionBlockers(context: MissionContext): PIEMissionBlocker[] {
  const executiveBlockers = [
    ...(context.executiveBrief?.escalations ?? []).map(escalation =>
      missionBlocker({
        id: `executive-escalation-${escalation.id}`,
        title: escalation.title,
        summary: escalation.reason,
        source: 'pie-executive',
        priority: escalation.urgency,
        confidence: escalation.confidence,
        evidence: escalation.evidence,
        suggestedAction: escalation.recommendedAction,
        blocksMission: escalation.urgency === 'critical',
      }),
    ),
    ...(context.executiveBrief?.rankedPriorities ?? [])
      .filter(priority => priority.shouldEscalate)
      .map(priority =>
        missionBlocker({
          id: `executive-priority-${priority.id}`,
          title: priority.title,
          summary: priority.summary,
          source: 'pie-executive',
          priority: priority.priority,
          confidence: priority.confidence,
          evidence: priority.evidence,
          suggestedAction: priority.recommendedAction,
          blocksMission: priority.priority === 'critical',
        }),
      ),
  ];
  const reflectionBlockers = [
    ...(context.reflection?.risks ?? []).map(risk =>
      missionBlocker({
        id: `reflection-risk-${risk.id}`,
        title: risk.title,
        summary: risk.risk,
        source: 'pie-reflection',
        priority: risk.priority,
        confidence: risk.confidence,
        evidence: risk.evidence,
        suggestedAction: risk.suggestedVerification,
        blocksMission: risk.priority === 'critical',
      }),
    ),
    ...(context.reflection?.gaps ?? [])
      .filter(gap => gap.priority === 'high' || gap.priority === 'critical')
      .map(gap =>
        missionBlocker({
          id: `reflection-gap-${gap.id}`,
          title: gap.title,
          summary: gap.summary,
          source: 'pie-reflection',
          priority: gap.priority,
          confidence: gap.confidence,
          evidence: gap.evidence,
          suggestedAction: gap.suggestedAction,
          blocksMission: gap.priority === 'critical',
        }),
      ),
  ];
  const decisionBlockers = (context.decisionQueue?.decisions ?? [])
    .filter(decision => decision.priority === 'critical' || decision.priority === 'high')
    .map(decision => blockerFromDecision(decision));
  const graphBlockers = [
    ...(context.knowledgeGraph?.relationships ?? [])
      .filter(relationship => relationship.edgeType === 'blocks')
      .map(relationship => blockerFromGraphRelationship(relationship)),
    ...(context.knowledgeGraph?.gaps ?? [])
      .filter(gap => gap.severity === 'high' || gap.severity === 'critical')
      .map(gap => blockerFromGraphGap(gap)),
  ];
  const behaviorBlockers = (context.behavior?.escalations ?? []).map(
    (escalation, index) =>
      missionBlocker({
        id: `behavior-escalation-${index}`,
        title: escalation.title,
        summary: escalation.summary || escalation.title,
        source: 'pie-behavior',
        priority: escalation.priority ?? 'high',
        confidence: escalation.confidence ?? 'medium',
        evidence: escalation.evidence ?? [],
        suggestedAction:
          escalation.suggestedAction || 'Review the Behavior escalation.',
        blocksMission: escalation.priority === 'critical',
      }),
  );

  return dedupeBlockers([
    ...executiveBlockers,
    ...reflectionBlockers,
    ...decisionBlockers,
    ...graphBlockers,
    ...behaviorBlockers,
  ]);
}

function buildMissionRecommendationsFromContext(
  context: MissionContext,
  definition: MissionDefinition,
  evidence: PIEMissionEvidence[],
  blockers: PIEMissionBlocker[],
): PIEMissionRecommendation[] {
  const recommendations: PIEMissionRecommendation[] = [];
  const topExecutive = context.executiveBrief?.recommendations[0];
  const nextDecision = context.decisionQueue?.nextBestAction;
  const reflectionQuestion = context.reflection?.verificationQuestions[0];
  const blocker = blockers[0];

  if (topExecutive) {
    recommendations.push({
      id: `mission-executive-${topExecutive.id}`,
      missionType: context.missionType,
      title: topExecutive.recommendation,
      recommendation: topExecutive.recommendation,
      why: topExecutive.why,
      evidence: topExecutive.evidence,
      confidence: topExecutive.confidence,
      priority: topExecutive.urgency,
      expectedImpact: topExecutive.expectedImpact,
      userApprovalRequired: topExecutive.userApprovalRequired,
      source: 'pie-executive',
    });
  }

  if (nextDecision) {
    recommendations.push({
      id: `mission-decision-${nextDecision.decisionId}`,
      missionType: context.missionType,
      title: nextDecision.title,
      recommendation: nextDecision.suggestedNextAction,
      why: nextDecision.why,
      evidence: nextDecision.evidence,
      confidence: nextDecision.confidence,
      priority: nextDecision.priority,
      expectedImpact: nextDecision.impact.description,
      userApprovalRequired: nextDecision.userApprovalRequired,
      source: 'pie-decision',
    });
  }

  if (reflectionQuestion) {
    recommendations.push({
      id: `mission-reflection-${reflectionQuestion.id}`,
      missionType: context.missionType,
      title: 'Verify what PIE is least certain about',
      recommendation: reflectionQuestion.question,
      why: reflectionQuestion.reason,
      evidence: reflectionQuestion.evidence,
      confidence: reflectionQuestion.confidence,
      priority: reflectionQuestion.priority,
      expectedImpact:
        'Improves PIE confidence before recommendations, reports, or decisions are treated as reliable.',
      userApprovalRequired: false,
      source: 'pie-reflection',
    });
  }

  if (blocker) {
    recommendations.push({
      id: `mission-blocker-${blocker.id}`,
      missionType: context.missionType,
      title: blocker.title,
      recommendation: blocker.suggestedAction,
      why: blocker.summary,
      evidence: blocker.evidence,
      confidence: blocker.confidence,
      priority: blocker.priority,
      expectedImpact:
        'Removes or clarifies the blocker that most limits the current mission.',
      userApprovalRequired: true,
      source: blocker.source,
    });
  }

  recommendations.push({
    id: `mission-default-${context.missionType}`,
    missionType: context.missionType,
    title: definition.objectiveTitle,
    recommendation: defaultMissionRecommendation(context.missionType),
    why: definition.purpose,
    evidence: evidence.slice(0, 5).map(item => item.detail),
    confidence: evidence.length > 0 ? missionEvidenceConfidence(evidence) : 'low',
    priority: definition.defaultPriority,
    expectedImpact: definition.expectedImpact,
    userApprovalRequired: missionRequiresApproval(context.missionType),
    source: 'mission-engine',
  });

  return dedupeRecommendations(recommendations).slice(0, 6);
}

function buildMissionSuccessCriteria(
  context: MissionContext,
  definition: MissionDefinition,
  evidence: PIEMissionEvidence[],
  evidenceNeeds: string[],
  blockers: PIEMissionBlocker[],
): PIEMissionSuccessCriteria[] {
  const evidenceDetails = evidence.map(item => item.detail);
  const criteria = definition.criteria.map((description, index) => {
    const met = missionCriterionMet(description, context, evidence, blockers);

    return {
      id: `mission-criteria-${context.missionType}-${index}`,
      description,
      met,
      required: true,
      evidence: met ? evidenceDetails.slice(0, 4) : evidenceNeeds.slice(0, 4),
      confidence: met ? missionEvidenceConfidence(evidence) : 'medium',
    };
  });

  criteria.push({
    id: `mission-criteria-${context.missionType}-approval-boundary`,
    description: 'User approval boundaries are preserved.',
    met: true,
    required: true,
    evidence: ['PIE prepares mission recommendations; the user approves action.'],
    confidence: 'high',
  });

  return criteria;
}

function buildMissionProgress(
  successCriteria: PIEMissionSuccessCriteria[],
  blockers: PIEMissionBlocker[],
): PIEMissionProgress {
  const requiredCriteria = successCriteria.filter(criteria => criteria.required);
  const completedCriteria = requiredCriteria.filter(criteria => criteria.met);
  const blockerPenalty = blockers.some(blocker => blocker.blocksMission) ? 20 : 0;
  const score = clamp(
    Math.round(
      (requiredCriteria.length === 0
        ? 0
        : (completedCriteria.length / requiredCriteria.length) * 100) -
        blockerPenalty,
    ),
    0,
    100,
  );
  const status = missionStatusFromProgress(score, blockers);

  return {
    score,
    status,
    summary:
      status === 'complete'
        ? 'Mission success criteria are complete.'
        : status === 'blocked'
          ? 'Mission progress is blocked by a high-priority issue or missing evidence.'
          : `${completedCriteria.length} of ${requiredCriteria.length} required mission criteria are met.`,
    completedCriteria: completedCriteria.map(criteria => criteria.description),
    remainingCriteria: requiredCriteria
      .filter(criteria => !criteria.met)
      .map(criteria => criteria.description),
  };
}

function buildMissionTransitions(
  context: MissionContext,
  progress: PIEMissionProgress,
  blockers: PIEMissionBlocker[],
): PIEMissionTransition[] {
  const transitions: PIEMissionTransition[] = [];
  const definition = MISSION_DEFINITIONS[context.missionType];

  if (blockers.some(blocker => blocker.priority === 'critical')) {
    transitions.push(transition({
      from: context.missionType,
      to: 'close-critical-risks',
      reason: 'A critical blocker should be reviewed before routine mission work.',
      condition: 'critical blocker present',
      confidence: 'high',
    }));
  }

  if (hasInspectionNeed(context)) {
    transitions.push(transition({
      from: context.missionType,
      to: 'inspection-verification',
      reason: 'Inspection status is limiting project confidence.',
      condition: 'inspection status missing or uncertain',
      confidence: 'medium',
    }));
  }

  if (progress.status === 'complete' && definition.nextMission) {
    transitions.push(transition({
      from: context.missionType,
      to: definition.nextMission,
      reason: `${definition.title} has enough support to move to the next useful mission.`,
      condition: 'mission complete',
      confidence: 'medium',
    }));
  }

  if (progress.status !== 'complete' && hasUncertaintyNeed(context)) {
    transitions.push(transition({
      from: context.missionType,
      to: 'reduce-project-uncertainty',
      reason: 'PIE needs stronger evidence before mission confidence improves.',
      condition: 'trust, understanding, reflection, or graph gaps are limiting confidence',
      confidence: 'medium',
    }));
  }

  transitions.push(transition({
    from: context.missionType,
    to: definition.nextMission ?? 'monitoring',
    reason: 'Default mission sequence.',
    condition: 'no higher-priority transition applies',
    confidence: 'low',
  }));

  return dedupeTransitions(transitions);
}

function getNextTransition(
  currentType: PIEMissionType,
  transitions: PIEMissionTransition[],
): PIEMissionTransition | null {
  return transitions.find(item => item.fromMission === currentType) ?? null;
}

function missionReason(
  context: MissionContext,
  definition: MissionDefinition,
  blockers: PIEMissionBlocker[],
): string {
  const topPriority = context.executiveBrief?.topPriority;
  const reflectionVerify = context.reflection?.whatPIEShouldVerifyFirst;

  if (blockers[0]) return blockers[0].summary;
  if (topPriority) return topPriority.summary;
  if (reflectionVerify) return reflectionVerify;
  if (context.decisionQueue?.nextBestAction) {
    return context.decisionQueue.nextBestAction.why;
  }

  return definition.purpose;
}

function missionPriority(
  context: MissionContext,
  definition: MissionDefinition,
  blockers: PIEMissionBlocker[],
  recommendations: PIEMissionRecommendation[],
): PIEDecisionPriority {
  return highestPriority([
    definition.defaultPriority,
    context.executiveBrief?.topPriority?.priority,
    context.decisionQueue?.nextBestAction.priority,
    context.reflection?.priority,
    ...blockers.map(blocker => blocker.priority),
    ...recommendations.map(recommendation => recommendation.priority),
  ]);
}

function missionConfidence(
  context: MissionContext,
  evidence: PIEMissionEvidence[],
  blockers: PIEMissionBlocker[],
): ProjectConfidenceLevel {
  const scores = [
    context.runtime?.overallConfidence,
    context.executiveBrief?.confidence,
    context.reflection?.reflectionLevel,
    context.decisionQueue?.confidence,
    context.memory?.confidence,
    context.intelligence?.confidence.level,
    evidence.length > 4 ? 'high' : evidence.length > 1 ? 'medium' : 'low',
    blockers.length > 3 ? 'low' : undefined,
  ].filter((item): item is ProjectConfidenceLevel => Boolean(item));

  return confidenceFromAverage(scores);
}

function missionTrust(
  context: MissionContext,
  fallback: ProjectConfidenceLevel,
): ProjectConfidenceLevel {
  return context.runtime?.trustScore.level ||
    context.reflection?.evidenceAudit.level ||
    context.intelligence?.confidence.level ||
    fallback;
}

function approvalRequirements(
  context: MissionContext,
  recommendations: PIEMissionRecommendation[],
): string[] {
  return uniqueText([
    ...recommendations
      .filter(recommendation => recommendation.userApprovalRequired)
      .map(recommendation => recommendation.recommendation),
    ...(context.executiveBrief?.userApprovalRequiredItems ?? []).map(
      item => item.title,
    ),
    ...(context.decisionQueue?.userApprovalRequiredDecisions ?? []).map(
      item => item.title,
    ),
  ]);
}

function missionSources(context: MissionContext): PIEMissionSource[] {
  return uniqueText([
    context.runtime ? 'pie-runtime' : null,
    context.executiveBrief ? 'pie-executive' : null,
    context.reflection ? 'pie-reflection' : null,
    context.behavior ? 'pie-behavior' : null,
    context.decisionQueue ? 'pie-decision' : null,
    context.memory ? 'pie-memory' : null,
    context.knowledgeGraph ? 'pie-knowledge-graph' : null,
    context.projectEvents.length > 0 ? 'project-event' : null,
    context.intelligence ? 'project-intelligence' : null,
    'mission-engine',
  ]) as PIEMissionSource[];
}

function missionCriterionMet(
  description: string,
  context: MissionContext,
  evidence: PIEMissionEvidence[],
  blockers: PIEMissionBlocker[],
): boolean {
  const text = `${description} ${evidence.map(item => item.detail).join(' ')}`.toLowerCase();

  if (description.includes('Top priority')) {
    return Boolean(context.executiveBrief?.topPriority || context.runtime?.currentPriority);
  }
  if (description.includes('Projects needing attention')) {
    return Boolean(
      (context.executiveBrief?.projectsNeedingAttention.length ?? 0) > 0 ||
        (context.runtime?.projectsNeedingAttention.length ?? 0) > 0,
    );
  }
  if (description.includes('Questions or approvals')) {
    return Boolean(
      (context.executiveBrief?.questionsForUser.length ?? 0) > 0 ||
        (context.decisionQueue?.userApprovalRequiredDecisions.length ?? 0) > 0 ||
        context.runtime,
    );
  }
  if (description.includes('Project and area')) {
    return Boolean(context.intelligence?.locationIntelligence.currentArea) ||
      text.includes('area');
  }
  if (description.includes('Current progress')) {
    return Boolean(
      (context.intelligence?.updateCount ?? 0) > 0 ||
        (context.intelligence?.photoCount ?? 0) > 0 ||
        evidence.some(item => item.source === 'project-event'),
    );
  }
  if (description.includes('Inspection')) {
    return !hasInspectionNeed(context) || text.includes('inspection');
  }
  if (description.includes('Critical risk')) {
    return blockers.some(blocker => blocker.priority === 'critical') ||
      hasCriticalRisk(context);
  }
  if (description.includes('Safety')) {
    return hasSafetySignal(context) || text.includes('safety');
  }
  if (description.includes('Issue')) {
    return hasIssueInvestigationNeed(context) || text.includes('issue');
  }
  if (description.includes('schedule') || description.includes('Schedule')) {
    return Boolean(
      (context.intelligence?.metrics.scheduleItemCount ?? 0) > 0 ||
        context.decisionQueue?.decisions.some(
          decision => decision.impact.area === 'schedule',
        ),
    );
  }
  if (description.includes('documentation') || description.includes('Documentation')) {
    return !hasDocumentationNeed(context) ||
      Boolean((context.intelligence?.metrics.documentCount ?? 0) > 0);
  }
  if (description.includes('User approval boundaries')) return true;

  return evidence.length > 0;
}

function defaultMissionRecommendation(type: PIEMissionType): string {
  switch (type) {
    case 'morning-brief':
      return 'Review PIE priorities and start with the highest-confidence management action.';
    case 'project-walk':
      return 'Begin Project Walk and verify the field evidence PIE needs most.';
    case 'executive-meeting-prep':
      return 'Review the executive brief, priority, risk, and approval-required decisions.';
    case 'customer-update-prep':
      return 'Prepare the customer update for review, with caveats where evidence is missing.';
    case 'inspection-verification':
      return 'Verify inspection status before treating the work as complete.';
    case 'reduce-project-uncertainty':
      return 'Collect the missing evidence that most improves trust and understanding.';
    case 'close-critical-risks':
      return 'Review the critical risk, impact, evidence, and required user decision.';
    case 'safety-verification':
      return 'Verify safety concern status before routine project work.';
    case 'issue-investigation':
      return 'Investigate the open issue and connect owner, area, schedule, and evidence.';
    case 'schedule-recovery':
      return 'Review overdue or blocked schedule work and prepare the recovery action.';
    case 'communication-preparation':
      return 'Prepare stakeholder communication for user review and approval.';
    case 'documentation-completion':
      return 'Complete the missing documentation that limits project confidence.';
    case 'monitoring':
      return 'Continue monitoring until meaningful project change or risk appears.';
  }
}

function missionRequiresApproval(type: PIEMissionType): boolean {
  return [
    'executive-meeting-prep',
    'customer-update-prep',
    'close-critical-risks',
    'safety-verification',
    'issue-investigation',
    'schedule-recovery',
    'communication-preparation',
  ].includes(type);
}

function normalizeMission(input: MissionInput): PIEMission {
  if (isMission(input)) return input;

  return buildMission(input);
}

function isMission(input: MissionInput): input is PIEMission {
  return Boolean(
    input &&
      typeof input === 'object' &&
      'missionType' in input &&
      'objective' in input &&
      'successCriteria' in input,
  );
}

function hasSafetySignal(context: Omit<MissionContext, 'missionType'>): boolean {
  return contextText(context).includes('safety') ||
    contextText(context).includes('hazard') ||
    (context.intelligence?.metrics.safetyConcernCount ?? 0) > 0;
}

function hasCriticalRisk(context: Omit<MissionContext, 'missionType'>): boolean {
  return Boolean(
    context.executiveBrief?.rankedPriorities.some(
      priority => priority.priority === 'critical',
    ) ||
      context.decisionQueue?.criticalDecisions.length ||
      context.reflection?.risks.some(risk => risk.priority === 'critical') ||
      context.runtime?.blockedItems.length,
  );
}

function hasInspectionNeed(context: Omit<MissionContext, 'missionType'>): boolean {
  return includesAny(contextText(context), [
    'inspection missing',
    'missing inspection',
    'inspection not recorded',
    'verify inspection',
    'inspection status',
  ]);
}

function hasScheduleRecoveryNeed(
  context: Omit<MissionContext, 'missionType'>,
): boolean {
  return Boolean(
    (context.intelligence?.overdueScheduleItems ?? 0) > 0 ||
      context.decisionQueue?.decisions.some(
        decision =>
          decision.impact.area === 'schedule' &&
          (decision.priority === 'high' || decision.priority === 'critical'),
      ) ||
      context.knowledgeGraph?.relationships.some(
        relationship => relationship.edgeType === 'blocks',
      ),
  );
}

function hasCommunicationNeed(
  context: Omit<MissionContext, 'missionType'>,
): boolean {
  return Boolean(
    context.decisionQueue?.communicationDecisions.length ||
      context.executiveBrief?.preparations.some(
        item => item.preparedFor === 'customer' || item.preparedFor === 'executive',
      ) ||
      context.intelligence?.communicationReadiness.level === 'ready',
  );
}

function hasIssueInvestigationNeed(
  context: Omit<MissionContext, 'missionType'>,
): boolean {
  return includesAny(contextText(context), ['issue', 'blocker', 'blocked']) ||
    (context.intelligence?.metrics.openIssueCount ?? 0) > 0;
}

function hasDocumentationNeed(
  context: Omit<MissionContext, 'missionType'>,
): boolean {
  return Boolean(
    context.reflection?.gaps.some(gap =>
      ['document', 'photo', 'update'].includes(gap.missingEvidenceType),
    ) ||
      context.memory?.gaps.some(gap =>
        includesAny(`${gap.title} ${gap.summary}`, [
          'document',
          'report',
          'photo',
          'update',
        ]),
      ) ||
      (context.intelligence &&
        context.intelligence.metrics.documentCount === 0 &&
        context.intelligence.photoCount === 0),
  );
}

function hasUncertaintyNeed(
  context: Omit<MissionContext, 'missionType'>,
): boolean {
  return Boolean(
    context.runtime?.trustScore.level === 'low' ||
      context.runtime?.understandingScore.level === 'low' ||
      context.reflection?.reflectionLevel === 'low' ||
      context.reflection?.gaps.length ||
      context.knowledgeGraph?.gaps.length ||
      context.intelligence?.confidence.level === 'low',
  );
}

function contextText(context: Omit<MissionContext, 'missionType'>): string {
  return [
    context.runtime?.summary.whatConcernsPIE,
    context.runtime?.summary.whatPIENeedsFromYou,
    context.executiveBrief?.executiveSummary,
    context.executiveBrief?.whatPIERecommendsNow,
    ...(context.executiveBrief?.rankedPriorities ?? []).flatMap(priority => [
      priority.title,
      priority.summary,
      priority.recommendedAction,
    ]),
    ...(context.reflection?.gaps ?? []).flatMap(gap => [
      gap.title,
      gap.summary,
      gap.suggestedAction,
    ]),
    ...(context.reflection?.verificationQuestions ?? []).map(
      question => question.question,
    ),
    ...(context.decisionQueue?.decisions ?? []).flatMap(decision => [
      decision.title,
      decision.summary,
      decision.suggestedNextAction,
    ]),
    ...(context.memory?.gaps ?? []).flatMap(gap => [
      gap.title,
      gap.summary,
      gap.suggestedAction,
    ]),
    ...(context.knowledgeGraph?.gaps ?? []).flatMap(gap => [
      gap.title,
      gap.summary,
      gap.suggestedAction,
    ]),
    ...(context.intelligence?.riskSignals ?? []).flatMap(risk => [
      risk.label,
      risk.message,
      risk.suggestedAction,
    ]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function blockerFromDecision(decision: PIEDecision): PIEMissionBlocker {
  return missionBlocker({
    id: `decision-${decision.id}`,
    title: decision.title,
    summary: decision.summary,
    source: 'pie-decision',
    priority: decision.priority,
    confidence: decision.confidence,
    evidence: decision.evidence,
    suggestedAction: decision.suggestedNextAction,
    blocksMission: decision.priority === 'critical',
  });
}

function blockerFromGraphRelationship(
  relationship: PIEGraphRelationship,
): PIEMissionBlocker {
  return missionBlocker({
    id: `graph-relationship-${relationship.id}`,
    title: 'Graph Blocked Item',
    summary: relationship.summary,
    source: 'pie-knowledge-graph',
    priority: 'high',
    confidence: relationship.confidence,
    evidence: [relationship.summary],
    suggestedAction: 'Review the blocked item and confirm owner, impact, and next step.',
    blocksMission: false,
  });
}

function blockerFromGraphGap(gap: PIEGraphGap): PIEMissionBlocker {
  return missionBlocker({
    id: `graph-gap-${gap.id}`,
    title: gap.title,
    summary: gap.summary,
    source: 'pie-knowledge-graph',
    priority: gap.severity,
    confidence: gap.confidence,
    evidence: [gap.summary],
    suggestedAction: gap.suggestedAction,
    blocksMission: gap.severity === 'critical',
  });
}

function missionEvidence(input: PIEMissionEvidence): PIEMissionEvidence {
  return input;
}

function missionBlocker(input: PIEMissionBlocker): PIEMissionBlocker {
  return input;
}

function transition({
  from,
  to,
  reason,
  condition,
  confidence,
}: {
  from: PIEMissionType;
  to: PIEMissionType;
  reason: string;
  condition: string;
  confidence: ProjectConfidenceLevel;
}): PIEMissionTransition {
  return {
    fromMission: from,
    toMission: to,
    reason,
    condition,
    confidence,
  };
}

function missionStatusFromProgress(
  score: number,
  blockers: PIEMissionBlocker[],
): PIEMissionStatus {
  if (blockers.some(blocker => blocker.blocksMission)) return 'blocked';
  if (score >= 95) return 'complete';
  if (score >= 70) return 'ready-for-approval';
  if (score <= 10) return 'not-started';

  return 'active';
}

function missionEvidenceConfidence(
  evidence: PIEMissionEvidence[],
): ProjectConfidenceLevel {
  return confidenceFromAverage(evidence.map(item => item.confidence));
}

function confidenceFromAverage(
  values: ProjectConfidenceLevel[],
): ProjectConfidenceLevel {
  if (values.length === 0) return 'low';

  const average =
    values.reduce((sum, value) => sum + confidenceScore(value), 0) /
    values.length;

  if (average >= 2.4) return 'high';
  if (average >= 1.6) return 'medium';

  return 'low';
}

function lowestConfidence(values: ProjectConfidenceLevel[]): ProjectConfidenceLevel {
  if (values.includes('low')) return 'low';
  if (values.includes('medium')) return 'medium';

  return 'high';
}

function confidenceScore(value: ProjectConfidenceLevel): number {
  if (value === 'high') return 3;
  if (value === 'medium') return 2;

  return 1;
}

function highestPriority(
  values: Array<PIEDecisionPriority | undefined | null>,
): PIEDecisionPriority {
  const priorities: PIEDecisionPriority[] = ['low', 'medium', 'high', 'critical'];

  return values.reduce<PIEDecisionPriority>((current, value) => {
    if (!value) return current;

    return priorities.indexOf(value) > priorities.indexOf(current)
      ? value
      : current;
  }, 'low');
}

function includesAny(value: string, patterns: string[]): boolean {
  const normalized = value.toLowerCase();

  return patterns.some(pattern => normalized.includes(pattern));
}

function dedupeEvidence(items: PIEMissionEvidence[]): PIEMissionEvidence[] {
  return dedupeBy(items, item => item.id).slice(0, 24);
}

function dedupeBlockers(items: PIEMissionBlocker[]): PIEMissionBlocker[] {
  return dedupeBy(items, item => `${item.title}:${item.summary}`).sort(
    (left, right) =>
      priorityRank(right.priority) - priorityRank(left.priority) ||
      Number(right.blocksMission) - Number(left.blocksMission),
  );
}

function dedupeRecommendations(
  items: PIEMissionRecommendation[],
): PIEMissionRecommendation[] {
  return dedupeBy(items, item => `${item.title}:${item.recommendation}`).sort(
    (left, right) =>
      priorityRank(right.priority) - priorityRank(left.priority) ||
      confidenceScore(right.confidence) - confidenceScore(left.confidence),
  );
}

function dedupeTransitions(
  items: PIEMissionTransition[],
): PIEMissionTransition[] {
  return dedupeBy(items, item => `${item.fromMission}:${item.toMission}`);
}

function dedupeBy<T>(items: T[], keyForItem: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  items.forEach(item => {
    const key = keyForItem(item).toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    result.push(item);
  });

  return result;
}

function priorityRank(priority: PIEDecisionPriority): number {
  switch (priority) {
    case 'critical':
      return 4;
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
      return 1;
  }
}

function uniqueText(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  values.forEach(value => {
    const trimmed = value?.trim();
    if (!trimmed) return;

    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    result.push(trimmed);
  });

  return result;
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'mission';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
