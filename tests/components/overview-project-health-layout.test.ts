import fs from 'fs';
import path from 'path';
import { StyleSheet } from 'react-native';

import { styles } from '../../components/app-shell-theme';

describe('Project Health mobile layout', () => {
  it('keeps five equal-width centered statistic columns at the 390-point screenshot width', () => {
    const content = StyleSheet.flatten(styles.content);
    const card = StyleSheet.flatten(styles.overviewHealthCard);
    const metrics = StyleSheet.flatten(styles.overviewHealthMetrics);
    const metric = StyleSheet.flatten(styles.overviewHealthMetric);
    const value = StyleSheet.flatten(styles.overviewHealthMetricValue);
    const label = StyleSheet.flatten(styles.overviewHealthMetricLabel);

    expect(metric).toMatchObject({
      flexBasis: 0,
      flexGrow: 1,
      minWidth: 0,
      alignItems: 'center',
    });
    expect(value).toMatchObject({ width: '100%', textAlign: 'center' });
    expect(label).toMatchObject({ width: '100%', textAlign: 'center' });
    expect(metrics.gap).toBe(0);

    const screenshotWidth = 390;
    const pagePadding = Number(content.padding);
    const cardHorizontalPadding = Number(card.paddingHorizontal);
    const availableMetricWidth =
      (screenshotWidth - (pagePadding * 2) - (cardHorizontalPadding * 2)) / 5;

    expect(availableMetricWidth).toBeCloseTo(64.4, 1);
  });

  it('renders every label word as a centered, non-wrapping native text line', () => {
    const root = path.resolve(__dirname, '../..');
    const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
    const healthCard = app.slice(
      app.indexOf('<View style={styles.overviewHealthCard}>'),
      app.indexOf('<OverviewResponsiveWorkspace>'),
    );

    expect(healthCard).toContain("{ label: 'Completed'");
    expect(healthCard).toContain("{ label: 'Field Updates'");
    expect(healthCard).toContain("metric.label.split(' ').map(word => (");
    expect(healthCard).toContain('style={styles.overviewHealthMetricLabel}');
    expect(healthCard).toContain('numberOfLines={1}');
    expect(healthCard).toContain('adjustsFontSizeToFit');
    expect(healthCard).toContain('minimumFontScale={0.82}');
  });
});
