import { StyleSheet, Text, View } from 'react-native';
import type {
  ProjectRisk,
  RiskImpact,
  RiskLikelihood,
  RiskSeverity,
} from '../services/ProjectRiskService';
import { colors } from './ProjectDetailsCard';
import { riskSeverityColor } from './RiskPriorityBadge';

const likelihoods: RiskLikelihood[] = ['High', 'Medium', 'Low'];
const impacts: RiskImpact[] = ['Low', 'Medium', 'High'];
const severityRank: Record<RiskSeverity, number> = {
  Low: 1,
  Medium: 2,
  High: 3,
  Critical: 4,
};

export function RiskMatrixGrid({
  risks,
}: {
  risks: ProjectRisk[];
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.label}>
        Risk Matrix
      </Text>

      <Text style={styles.subtitle}>
        Risks are grouped by likelihood and impact. Cell color reflects the highest severity in that cell.
      </Text>

      <View style={styles.grid}>
        <View style={styles.headerCell} />

        {impacts.map(impact => (
          <View
            key={impact}
            style={styles.headerCell}
          >
            <Text style={styles.headerText}>
              {impact}
            </Text>
          </View>
        ))}

        {likelihoods.map(likelihood => (
          <RiskMatrixRow
            key={likelihood}
            likelihood={likelihood}
            risks={risks}
          />
        ))}
      </View>

      <View style={styles.axisRow}>
        <Text style={styles.axisText}>
          Likelihood
        </Text>

        <Text style={styles.axisText}>
          Impact
        </Text>
      </View>
    </View>
  );
}

function RiskMatrixRow({
  likelihood,
  risks,
}: {
  likelihood: RiskLikelihood;
  risks: ProjectRisk[];
}) {
  return (
    <>
      <View style={styles.rowHeaderCell}>
        <Text style={styles.headerText}>
          {likelihood}
        </Text>
      </View>

      {impacts.map(impact => (
        <RiskMatrixCell
          key={`${likelihood}-${impact}`}
          likelihood={likelihood}
          impact={impact}
          risks={risks}
        />
      ))}
    </>
  );
}

function RiskMatrixCell({
  likelihood,
  impact,
  risks,
}: {
  likelihood: RiskLikelihood;
  impact: RiskImpact;
  risks: ProjectRisk[];
}) {
  const cellRisks = risks.filter(
    risk => risk.likelihood === likelihood && risk.impact === impact,
  );
  const topSeverity = cellRisks
    .map(risk => risk.severity)
    .sort((a, b) => severityRank[b] - severityRank[a])[0] || 'Low';
  const color = cellRisks.length > 0
    ? riskSeverityColor(topSeverity)
    : colors.line;

  return (
    <View
      style={[
        styles.cell,
        {
          backgroundColor: cellRisks.length > 0
            ? `${color}1A`
            : colors.fill,
          borderColor: cellRisks.length > 0
            ? color
            : colors.line,
        },
      ]}
    >
      <Text
        style={[
          styles.cellCount,
          {
            color: cellRisks.length > 0
              ? color
              : colors.tertiaryText,
          },
        ]}
      >
        {cellRisks.length}
      </Text>

      <Text style={styles.cellLabel}>
        {cellRisks.length === 1 ? 'risk' : 'risks'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },

  label: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 6,
    textTransform: 'uppercase',
  },

  subtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    marginBottom: 12,
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },

  headerCell: {
    width: '22%',
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },

  rowHeaderCell: {
    width: '22%',
    minHeight: 62,
    alignItems: 'center',
    justifyContent: 'center',
  },

  headerText: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
  },

  cell: {
    width: '22%',
    minHeight: 62,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 7,
  },

  cellCount: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '900',
  },

  cellLabel: {
    color: colors.muted,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
  },

  axisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },

  axisText: {
    color: colors.tertiaryText,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
});
