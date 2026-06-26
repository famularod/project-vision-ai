import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { AIAnalysisButton } from '../components/AIAnalysisButton';
import { AIAnalysisResultCard } from '../components/AIAnalysisResultCard';
import { ExecutiveBriefCard } from '../components/ExecutiveBriefCard';
import { ExecutiveBriefSection } from '../components/ExecutiveBriefSection';
import {
  ScreenTitle,
  SecondaryButton,
  styles,
} from '../components/ProjectDetailsCard';
import { analyzeProjectCoach } from '../services/AIProjectCoach';
import { analyzeProjectWithAI } from '../services/ProjectAIAnalysisService';
import type { ProjectAIAnalysisResult } from '../services/ProjectAIAnalysisService';
import type {
  ProjectUpdate,
  ScheduleItem,
  UpdatePhoto,
} from '../types';
import { formatDisplayDate } from '../utils/date';

function isSameProject(projectName: string, nextProjectName: string) {
  return projectName.trim().toLowerCase() === nextProjectName.trim().toLowerCase();
}

function hasUpdateContent(update: ProjectUpdate) {
  return update.photos.length > 0 || update.notes.trim().length > 0;
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatUpdateDate(date: string) {
  const trimmed = date.trim();

  if (!trimmed) return 'an unknown date';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  return formatDisplayDate(trimmed);
}

function truncateText(value: string, maxLength = 140) {
  const trimmed = value.trim().replace(/\s+/g, ' ');

  if (trimmed.length <= maxLength) return trimmed;

  return `${trimmed.slice(0, maxLength - 3).trim()}...`;
}

function updateLocation(update: ProjectUpdate) {
  return (
    update.selectedAreaName ||
    update.photos.find(photo => photo.selectedAreaName)?.selectedAreaName ||
    ''
  );
}

function actionPhotoCount(photos: UpdatePhoto[]) {
  return photos.filter(photo => photo.category !== 'Update').length;
}

function buildRecentChanges({
  projectName,
  updates,
  currentUpdate,
}: {
  projectName: string;
  updates: ProjectUpdate[];
  currentUpdate: ProjectUpdate | null;
}) {
  const savedProjectUpdates = updates
    .filter(update => isSameProject(projectName, update.projectName))
    .sort((a, b) => b.date.localeCompare(a.date));
  const changes: string[] = [];
  const currentUpdateHasContent =
    currentUpdate &&
    isSameProject(projectName, currentUpdate.projectName) &&
    hasUpdateContent(currentUpdate) &&
    !savedProjectUpdates.some(update => update.id === currentUpdate.id);

  if (currentUpdateHasContent) {
    const notesText = currentUpdate.notes.trim()
      ? ' with draft notes'
      : '';

    changes.push(
      `Current draft has ${countLabel(currentUpdate.photos.length, 'photo')}${notesText} ready for review.`,
    );
  }

  const latestUpdate = savedProjectUpdates[0];

  if (latestUpdate) {
    const location = updateLocation(latestUpdate);
    const locationText = location ? ` for ${location}` : '';
    const actionCount = actionPhotoCount(latestUpdate.photos);

    changes.push(
      `Latest saved update was ${formatUpdateDate(latestUpdate.date)}${locationText} with ${countLabel(latestUpdate.photos.length, 'photo')} and ${countLabel(actionCount, 'tracked issue')}.`,
    );

    if (latestUpdate.notes.trim()) {
      changes.push(`Latest update notes: ${truncateText(latestUpdate.notes)}.`);
    }
  }

  if (savedProjectUpdates.length > 1) {
    const previousUpdate = savedProjectUpdates[1];

    changes.push(
      `Previous saved update was ${formatUpdateDate(previousUpdate.date)}, giving executives ${countLabel(savedProjectUpdates.length, 'saved update')} of project history.`,
    );
  }

  if (changes.length === 0) {
    changes.push('No saved updates or draft changes are available for this project yet.');
  }

  return changes.slice(0, 4);
}

function firstItems(items: string[], count: number, fallback: string) {
  return items.length > 0 ? items.slice(0, count) : [fallback];
}

export function AIExecutiveBriefScreen({
  projectName,
  updates,
  scheduleItems,
  currentUpdate,
  onBack,
  onWeeklyExecutiveReport,
  onExecutiveKPIDashboard,
  onPortfolioDashboard,
}: {
  projectName: string;
  updates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  currentUpdate: ProjectUpdate | null;
  onBack: () => void;
  onWeeklyExecutiveReport?: () => void;
  onExecutiveKPIDashboard?: () => void;
  onPortfolioDashboard?: () => void;
}) {
  const [aiLoading, setAILoading] = useState(false);
  const [aiResult, setAIResult] = useState<ProjectAIAnalysisResult | null>(null);
  const displayProjectName = projectName.trim() || 'Selected Project';
  const analysis = useMemo(
    () =>
      analyzeProjectCoach({
        projectName: displayProjectName,
        updates,
        scheduleItems,
        currentUpdate,
      }),
    [currentUpdate, displayProjectName, scheduleItems, updates],
  );
  const recentChanges = useMemo(
    () =>
      buildRecentChanges({
        projectName: displayProjectName,
        updates,
        currentUpdate,
      }),
    [currentUpdate, displayProjectName, updates],
  );

  async function runAIAnalysis() {
    setAILoading(true);

    try {
      const result = await analyzeProjectWithAI({
        projectName: displayProjectName,
        updates,
        scheduleItems,
        currentUpdate,
        mode: 'executive-brief',
      });

      setAIResult(result);
    } finally {
      setAILoading(false);
    }
  }

  return (
    <View>
      <ScreenTitle
        title="AI Executive Brief"
        subtitle={`Executive summary for ${displayProjectName}. Generated locally without an external AI service.`}
      />

      <SecondaryButton
        label="Back to Home"
        icon="arrow-back-outline"
        onPress={onBack}
      />

      {onWeeklyExecutiveReport ? (
        <SecondaryButton
          label="Weekly Report"
          icon="newspaper-outline"
          onPress={onWeeklyExecutiveReport}
        />
      ) : null}

      {onExecutiveKPIDashboard ? (
        <SecondaryButton
          label="KPI Dashboard"
          icon="stats-chart-outline"
          onPress={onExecutiveKPIDashboard}
        />
      ) : null}

      {onPortfolioDashboard ? (
        <SecondaryButton
          label="Portfolio"
          icon="albums-outline"
          onPress={onPortfolioDashboard}
        />
      ) : null}

      <ExecutiveBriefCard
        score={analysis.score}
        projectName={displayProjectName}
        summary={analysis.summary}
      />

      <AIAnalysisButton
        loading={aiLoading}
        onPress={() => {
          void runAIAnalysis();
        }}
      />

      <Text style={styles.mutedNote}>
        Rule-based analysis is always available. Project data is sent to the configured AI provider only after you tap Analyze with AI.
      </Text>

      {aiResult ? (
        <AIAnalysisResultCard result={aiResult} />
      ) : null}

      <ExecutiveBriefSection
        title="Key Accomplishments"
        subtitle="The strongest positive signals from project updates and schedule data."
        items={firstItems(
          analysis.accomplishments,
          3,
          'No accomplishments are available from the current project data yet.',
        )}
        tone="success"
        icon="checkmark-circle-outline"
      />

      <ExecutiveBriefSection
        title="Top Risks"
        subtitle="The highest-priority watch items for executive visibility."
        items={firstItems(
          analysis.risks,
          3,
          'No recent risks identified from the current local data.',
        )}
        tone="warning"
        icon="warning-outline"
      />

      <ExecutiveBriefSection
        title="Recommended Executive Actions"
        subtitle="Concise next steps based on the deterministic project analysis."
        items={firstItems(
          analysis.recommendations,
          3,
          'Continue the current update cadence and monitor project conditions.',
        )}
        icon="flag-outline"
      />

      <ExecutiveBriefSection
        title="What Changed Recently"
        subtitle="Recent movement from saved updates and the current draft."
        items={recentChanges}
        icon="time-outline"
      />
    </View>
  );
}
