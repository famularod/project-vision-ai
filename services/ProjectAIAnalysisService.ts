import { analyzeProjectCoach } from './AIProjectCoach';
import type { AIProviderName } from './AIClientBoundaryService';
import type {
  AIProjectCoachAnalysis,
} from './AIProjectCoach';
import type {
  ProjectUpdate,
  ScheduleItem,
  UpdatePhoto,
} from '../types';

export type ProjectAIAnalysisMode = 'project-coach' | 'executive-brief';

export type ProjectAIAnalysis = {
  executiveSummary: string;
  risks: string[];
  recommendedActions: string[];
  accomplishments: string[];
  healthScoreExplanation: string;
};

export type ProjectAIAnalysisResult = {
  status: 'ai' | 'fallback';
  provider: AIProviderName | 'rule-based';
  model: string;
  message: string;
  analysis: ProjectAIAnalysis;
};

type AnalyzeProjectWithAIParams = {
  projectName: string;
  updates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  currentUpdate: ProjectUpdate | null;
  mode: ProjectAIAnalysisMode;
};

function isSameProject(projectName: string, nextProjectName: string) {
  return projectName.trim().toLowerCase() === nextProjectName.trim().toLowerCase();
}

function hasUpdateContent(update: ProjectUpdate) {
  return update.photos.length > 0 || update.notes.trim().length > 0;
}

function firstItems(items: string[], fallback: string) {
  return items.length > 0 ? items.slice(0, 5) : [fallback];
}

function compactText(value: string, fallback = '') {
  return value.trim().replace(/\s+/g, ' ') || fallback;
}

function projectUpdates({
  projectName,
  updates,
  currentUpdate,
}: {
  projectName: string;
  updates: ProjectUpdate[];
  currentUpdate: ProjectUpdate | null;
}) {
  const savedProjectUpdates = updates.filter(update =>
    isSameProject(projectName, update.projectName),
  );
  const includeCurrentUpdate =
    currentUpdate &&
    isSameProject(projectName, currentUpdate.projectName) &&
    hasUpdateContent(currentUpdate) &&
    !savedProjectUpdates.some(update => update.id === currentUpdate.id);

  return includeCurrentUpdate
    ? [currentUpdate, ...savedProjectUpdates]
    : savedProjectUpdates;
}


function fallbackAnalysis(analysis: AIProjectCoachAnalysis): ProjectAIAnalysis {
  return {
    executiveSummary: analysis.summary,
    risks: firstItems(
      analysis.risks,
      'No recent risks identified from the current local data.',
    ),
    recommendedActions: firstItems(
      analysis.recommendations,
      'Continue the current update cadence and monitor project conditions.',
    ),
    accomplishments: firstItems(
      analysis.accomplishments,
      'No accomplishments are available from the current project data yet.',
    ),
    healthScoreExplanation: `Rule-based project health score is ${analysis.score}/100 based on update cadence, photos, action items, safety concerns, and schedule status.`,
  };
}

export async function analyzeProjectWithAI({
  projectName,
  updates,
  scheduleItems,
  currentUpdate,
  mode,
}: AnalyzeProjectWithAIParams): Promise<ProjectAIAnalysisResult> {
  const ruleBasedAnalysis = analyzeProjectCoach({
    projectName,
    updates,
    scheduleItems,
    currentUpdate,
  });

  return {
    status: 'fallback',
    provider: 'rule-based',
    model: 'local-rules',
    message:
      'Direct mobile AI analysis is disabled. Photo intelligence runs through the Supabase Edge Function.',
    analysis: fallbackAnalysis(ruleBasedAnalysis),
  };
}
