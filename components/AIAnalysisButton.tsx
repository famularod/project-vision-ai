import { PrimaryButton } from './ProjectDetailsCard';

export function AIAnalysisButton({
  loading,
  onPress,
}: {
  loading: boolean;
  onPress: () => void;
}) {
  return (
    <PrimaryButton
      label={loading ? 'Analyzing...' : 'Analyze with AI'}
      icon="sparkles-outline"
      onPress={onPress}
      disabled={loading}
    />
  );
}
