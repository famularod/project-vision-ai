import { analyzeProjectCoach } from './AIProjectCoach';
import {
  generateOpenAIText,
  getAIConfigurationStatus,
} from './OpenAIService';
import type { AIProviderName } from './OpenAIService';
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

type SanitizedPhoto = {
  category: string;
  caption: string;
  actionRequired: string;
  actionOwner: string;
  actionDueDate: string;
  actionStatus: string;
  area: string;
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

function sanitizePhoto(update: ProjectUpdate, photo: UpdatePhoto): SanitizedPhoto {
  return {
    category: photo.category,
    caption: compactText(photo.caption, 'No caption'),
    actionRequired: compactText(photo.actionRequired),
    actionOwner: compactText(photo.actionOwner),
    actionDueDate: compactText(photo.actionDueDate),
    actionStatus: photo.actionStatus,
    area: compactText(photo.selectedAreaName || update.selectedAreaName || ''),
  };
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

function sanitizedProjectContext({
  projectName,
  updates,
  scheduleItems,
  currentUpdate,
  ruleBasedAnalysis,
}: AnalyzeProjectWithAIParams & {
  ruleBasedAnalysis: AIProjectCoachAnalysis;
}) {
  const relatedUpdates = projectUpdates({
    projectName,
    updates,
    currentUpdate,
  })
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8)
    .map(update => ({
      date: update.date,
      area: compactText(update.selectedAreaName || ''),
      notes: compactText(update.notes),
      photos: update.photos.slice(0, 12).map(photo => sanitizePhoto(update, photo)),
      photoCount: update.photos.length,
    }));
  const relatedScheduleItems = scheduleItems
    .filter(item => isSameProject(projectName, item.projectName))
    .slice(0, 20)
    .map(item => ({
      taskName: item.taskName,
      milestone: item.milestone,
      locationName: item.locationName,
      startDate: item.startDate,
      finishDate: item.finishDate,
      owner: item.owner,
      contractor: item.contractor,
      percentComplete: item.percentComplete,
      priority: item.priority,
      status: item.status,
      notes: compactText(item.notes),
    }));

  return {
    projectName,
    generatedFor: 'Project photo update tool',
    ruleBasedAnalysis,
    updates: relatedUpdates,
    scheduleItems: relatedScheduleItems,
  };
}

function instructionsForMode(mode: ProjectAIAnalysisMode) {
  const audience =
    mode === 'executive-brief'
      ? 'executive leadership'
      : 'a construction project manager';

  return [
    `You are analyzing construction project status for ${audience}.`,
    'Use only the provided JSON data. Do not invent projects, dates, people, documents, photos, or site facts.',
    'Return valid JSON only, with this exact shape:',
    '{"executiveSummary":"string","risks":["string"],"recommendedActions":["string"],"accomplishments":["string"],"healthScoreExplanation":"string"}',
    'Keep each list to 3-5 concise items.',
    'Mention when data is missing or stale instead of guessing.',
    'Do not include markdown fences or commentary outside JSON.',
  ].join('\n');
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

function parseAnalysisJson(value: string): ProjectAIAnalysis {
  const trimmed = value.trim();
  const jsonText = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
    : trimmed;
  const parsed = JSON.parse(jsonText) as Partial<ProjectAIAnalysis>;

  return {
    executiveSummary: compactText(parsed.executiveSummary || ''),
    risks: Array.isArray(parsed.risks)
      ? parsed.risks.map(item => compactText(String(item))).filter(Boolean)
      : [],
    recommendedActions: Array.isArray(parsed.recommendedActions)
      ? parsed.recommendedActions.map(item => compactText(String(item))).filter(Boolean)
      : [],
    accomplishments: Array.isArray(parsed.accomplishments)
      ? parsed.accomplishments.map(item => compactText(String(item))).filter(Boolean)
      : [],
    healthScoreExplanation: compactText(parsed.healthScoreExplanation || ''),
  };
}

function completeAnalysis(
  aiAnalysis: ProjectAIAnalysis,
  fallback: ProjectAIAnalysis,
) {
  return {
    executiveSummary: aiAnalysis.executiveSummary || fallback.executiveSummary,
    risks: aiAnalysis.risks.length > 0 ? aiAnalysis.risks : fallback.risks,
    recommendedActions:
      aiAnalysis.recommendedActions.length > 0
        ? aiAnalysis.recommendedActions
        : fallback.recommendedActions,
    accomplishments:
      aiAnalysis.accomplishments.length > 0
        ? aiAnalysis.accomplishments
        : fallback.accomplishments,
    healthScoreExplanation:
      aiAnalysis.healthScoreExplanation || fallback.healthScoreExplanation,
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
  const fallback = fallbackAnalysis(ruleBasedAnalysis);
  const status = getAIConfigurationStatus();

  if (!status.configured) {
    return {
      status: 'fallback',
      provider: 'rule-based',
      model: status.model,
      message: status.message,
      analysis: fallback,
    };
  }

  try {
    const aiResponse = await generateOpenAIText({
      instructions: instructionsForMode(mode),
      input: JSON.stringify(
        sanitizedProjectContext({
          projectName,
          updates,
          scheduleItems,
          currentUpdate,
          mode,
          ruleBasedAnalysis,
        }),
      ),
    });

    return {
      status: 'ai',
      provider: aiResponse.provider,
      model: aiResponse.model,
      message: 'AI analysis generated from the project data you chose to send.',
      analysis: completeAnalysis(parseAnalysisJson(aiResponse.text), fallback),
    };
  } catch (error) {
    return {
      status: 'fallback',
      provider: 'rule-based',
      model: status.model,
      message:
        error instanceof Error
          ? `AI analysis failed: ${error.message}. Showing rule-based analysis instead.`
          : 'AI analysis failed. Showing rule-based analysis instead.',
      analysis: fallback,
    };
  }
}
