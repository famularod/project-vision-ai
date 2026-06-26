import { Ionicons } from '@expo/vector-icons';
import { ScreenMetric } from './layout/ScreenMetric';
import { IconName } from './ProjectDetailsCard';
import { colors } from '../theme';

type MetricTone = 'neutral' | 'warning' | 'danger' | 'success';

const toneColors: Record<MetricTone, string> = {
  neutral: colors.primary,
  warning: colors.warning,
  danger: colors.danger,
  success: colors.success,
};

export function WeeklyReportMetricCard({
  label,
  value,
  subtitle,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  subtitle: string;
  icon: IconName;
  tone?: MetricTone;
}) {
  const color = toneColors[tone];

  return (
    <ScreenMetric
      label={label}
      value={value}
      detail={subtitle}
      tone={tone === 'neutral' ? 'default' : tone}
      icon={
        <Ionicons
          name={icon}
          size={19}
          color={color}
        />
      }
    />
  );
}
