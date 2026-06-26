import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { AIAnalysisButton } from '../components/AIAnalysisButton';
import { AIAnalysisResultCard } from '../components/AIAnalysisResultCard';
import { AICoachRecommendationCard } from '../components/AICoachRecommendationCard';
import { AICoachSection } from '../components/AICoachSection';
import { AIProjectHealthCard } from '../components/AIProjectHealthCard';
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
} from '../types';

export function AIProjectCoachScreen({
  projectName,
  updates,
  scheduleItems,
  currentUpdate,
  onBack,
  onProjectRiskMatrix,
}: {
  projectName: string;
  updates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  currentUpdate: ProjectUpdate | null;
  onBack: () => void;
  onProjectRiskMatrix?: () => void;
}) {
  const [aiLoading, setAILoading] = useState(false);
  const [aiResult, setAIResult] = useState<ProjectAIAnalysisResult | null>(null);
  const analysis = useMemo(
    () =>
      analyzeProjectCoach({
        projectName,
        updates,
        scheduleItems,
        currentUpdate,
      }),
    [currentUpdate, projectName, scheduleItems, updates],
  );

  async function runAIAnalysis() {
    setAILoading(true);

    try {
      const result = await analyzeProjectWithAI({
        projectName,
        updates,
        scheduleItems,
        currentUpdate,
        mode: 'project-coach',
      });

      setAIResult(result);
    } finally {
      setAILoading(false);
    }
  }

  return (
    <View>
      <ScreenTitle
        title="AI Project Coach"
        subtitle={`Local deterministic analysis for ${projectName}. No external AI service is used.`}
      />

      <SecondaryButton
        label="Back to Home"
        icon="arrow-back-outline"
        onPress={onBack}
      />

      {onProjectRiskMatrix ? (
        <SecondaryButton
          label="Risk Matrix"
          icon="warning-outline"
          onPress={onProjectRiskMatrix}
        />
      ) : null}

      <AIProjectHealthCard
        score={analysis.score}
        projectName={projectName}
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

      <AICoachSection
        title="Accomplishments"
        subtitle="Generated from captured updates, photos, action items, and schedule data."
      >
        {analysis.accomplishments.map((item, index) => (
          <AICoachRecommendationCard
            key={item}
            title={`Accomplishment ${index + 1}`}
            text={item}
            tone="success"
          />
        ))}
      </AICoachSection>

      <AICoachSection
        title="Risks"
        subtitle="Generated from open action items, safety concerns, overdue schedule items, and update cadence."
      >
        {analysis.risks.map((item, index) => (
          <AICoachRecommendationCard
            key={item}
            title={`Risk ${index + 1}`}
            text={item}
            tone="warning"
          />
        ))}
      </AICoachSection>

      <AICoachSection
        title="Recommended Actions"
        subtitle="Generated with deterministic local rules."
      >
        {analysis.recommendations.map((item, index) => (
          <AICoachRecommendationCard
            key={item}
            title={`Recommendation ${index + 1}`}
            text={item}
          />
        ))}
      </AICoachSection>

      <AICoachSection
        title="Executive Summary"
        subtitle="Generated from the same local analysis engine."
      >
        <AICoachRecommendationCard
          title="Project summary"
          text={analysis.summary}
        />
      </AICoachSection>
    </View>
  );
}
