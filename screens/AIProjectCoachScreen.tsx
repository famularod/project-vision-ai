import { Text, View } from 'react-native';
import { AICoachRecommendationCard } from '../components/AICoachRecommendationCard';
import { AICoachSection } from '../components/AICoachSection';
import { AIProjectHealthCard } from '../components/AIProjectHealthCard';
import {
  PrimaryButton,
  ScreenTitle,
  SecondaryButton,
  styles,
} from '../components/ProjectDetailsCard';

export function AIProjectCoachScreen({
  onBack,
}: {
  onBack: () => void;
}) {
  return (
    <View>
      <ScreenTitle
        title="AI Project Coach"
        subtitle="UI-only v1 placeholder. Sample insights are shown here without connecting to an AI service."
      />

      <SecondaryButton
        label="Back to Home"
        icon="arrow-back-outline"
        onPress={onBack}
      />

      <AIProjectHealthCard />

      <PrimaryButton
        label="Analyze Project"
        icon="sparkles-outline"
        onPress={() => undefined}
        disabled
      />

      <Text style={styles.mutedNote}>
        Analyze Project is disabled in v1. No OpenAI or external API call is made from this screen.
      </Text>

      <AICoachSection
        title="Accomplishments"
        subtitle="Placeholder/sample content."
      >
        <AICoachRecommendationCard
          title="Recent field progress"
          text="Sample insight: recent updates suggest visible progress has been captured and documented for leadership review."
          tone="success"
        />

        <AICoachRecommendationCard
          title="Documentation momentum"
          text="Sample insight: photos, notes, and saved updates would be summarized here once analysis is connected."
          tone="success"
        />
      </AICoachSection>

      <AICoachSection
        title="Risks"
        subtitle="Placeholder/sample content."
      >
        <AICoachRecommendationCard
          title="Open issue watchlist"
          text="Sample risk: unresolved action items and overdue tasks would be highlighted here for follow-up."
          tone="warning"
        />

        <AICoachRecommendationCard
          title="Schedule pressure"
          text="Sample risk: items due soon would be compared against recent updates once analysis is enabled."
          tone="warning"
        />
      </AICoachSection>

      <AICoachSection
        title="Recommended Actions"
        subtitle="Placeholder/sample content."
      >
        <AICoachRecommendationCard
          title="Confirm owners for open actions"
          text="Sample recommendation: assign owners and due dates for any unresolved field items before the next update."
        />

        <AICoachRecommendationCard
          title="Prepare leadership summary"
          text="Sample recommendation: turn the latest photos and notes into a short status brief when AI analysis is added."
        />
      </AICoachSection>

      <AICoachSection
        title="Executive Summary"
        subtitle="Placeholder/sample content."
      >
        <AICoachRecommendationCard
          title="Draft summary"
          text="Sample executive summary: project activity appears active, with progress captured and several follow-up items to monitor. This is static placeholder text."
        />
      </AICoachSection>
    </View>
  );
}
