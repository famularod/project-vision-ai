import { Link, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { colors, spacing } from '../../theme';
import {
  desktopNavigationItems,
  desktopRouteIsActive,
  type DesktopReadOnlyPage,
} from './desktop-navigation';

const pageContent: Record<DesktopReadOnlyPage, {
  eyebrow: string;
  title: string;
  description: string;
  sections: readonly { title: string; detail: string }[];
}> = {
  overview: {
    eyebrow: 'DESKTOP FOUNDATION',
    title: 'DAVE Command Center',
    description: 'A secure, read-only browser workspace for office and portfolio review.',
    sections: [
      { title: 'Project portfolio', detail: 'Authorized project health and priorities will appear here after browser authentication is approved.' },
      { title: 'Current attention', detail: 'Evidence-backed issues will use the same authority rules as the field app.' },
      { title: 'Recent activity', detail: 'Cross-device activity will remain read-only during the pilot.' },
    ],
  },
  projects: {
    eyebrow: 'PROJECTS',
    title: 'Authorized projects',
    description: 'Select and review projects without changing field data.',
    sections: [
      { title: 'No live projects loaded', detail: 'Project access stays disabled until the reviewed browser session and authorization boundary is connected.' },
    ],
  },
  tasks: {
    eyebrow: 'TASKS & SCHEDULE',
    title: 'Schedule review',
    description: 'Review activities, progress, dates, dependencies, and reconciliation results.',
    sections: [
      { title: 'Read-only pilot', detail: 'Schedule imports, edits, and bulk operations remain disabled until Phase 4.' },
    ],
  },
  evidence: {
    eyebrow: 'DAVE EVIDENCE',
    title: 'Evidence and conclusions',
    description: 'Review source-backed project evidence, uncertainty, and approved conclusions.',
    sections: [
      { title: 'One authority model', detail: 'The browser will consume the same versioned DAVE intelligence as native clients.' },
    ],
  },
  documents: {
    eyebrow: 'DOCUMENTS',
    title: 'Project document library',
    description: 'Review authorized documents, versions, and import status.',
    sections: [
      { title: 'Native capability replacement pending', detail: 'Browser upload, download, OCR, and retention controls require explicit capability and authorization review.' },
    ],
  },
  reports: {
    eyebrow: 'REPORTS',
    title: 'Report review',
    description: 'Review report drafts, evidence, approval state, and distribution history.',
    sections: [
      { title: 'Approval boundary preserved', detail: 'Generation, approval, sending, and editing remain disabled in the read-only pilot.' },
    ],
  },
};

export function DesktopReadOnlyShell({ page }: { page: DesktopReadOnlyPage }) {
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const [hasMounted, setHasMounted] = useState(false);
  const usesSidebar = hasMounted && width >= 900;
  const content = pageContent[page];

  useEffect(() => {
    setHasMounted(true);
  }, []);

  return (
    <View style={[styles.root, usesSidebar && styles.rootWide]}>
      {usesSidebar ? <DesktopSidebar pathname={pathname} /> : null}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
      >
        {!usesSidebar ? <DesktopTopNavigation pathname={pathname} /> : null}
        <View style={styles.topRow}>
          <View style={styles.titleBlock}>
            <Text style={styles.eyebrow} accessibilityRole="header">{content.eyebrow}</Text>
            <Text style={styles.title} accessibilityRole="header">{content.title}</Text>
            <Text style={styles.description}>{content.description}</Text>
          </View>
          <View style={styles.readOnlyBadge} accessibilityLabel="Read-only pilot">
            <Text style={styles.readOnlyBadgeText}>READ ONLY</Text>
          </View>
        </View>

        <View style={styles.safetyBanner} accessibilityRole="alert">
          <Text style={styles.safetyTitle}>Browser foundation only</Text>
          <Text style={styles.safetyDetail}>
            Live account data is intentionally unavailable until browser authentication and server authorization are reviewed and approved.
          </Text>
        </View>

        <View style={[styles.cardGrid, width >= 1180 && styles.cardGridWide]}>
          {content.sections.map(section => (
            <View key={section.title} style={styles.card}>
              <Text style={styles.cardTitle} accessibilityRole="header">{section.title}</Text>
              <Text style={styles.cardDetail}>{section.detail}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function DesktopSidebar({ pathname }: { pathname: string }) {
  return (
    <View style={styles.sidebar}>
      <View style={styles.brandRow}>
        <View style={styles.brandMark}><Text style={styles.brandMarkText}>D</Text></View>
        <View>
          <Text style={styles.brandName}>DAVE</Text>
          <Text style={styles.brandSubtitle}>Project Vision AI</Text>
        </View>
      </View>
      <View style={styles.navigation} role="navigation">
        {desktopNavigationItems.map(item => (
          <DesktopNavigationLink key={item.href} pathname={pathname} item={item} />
        ))}
      </View>
      <Text style={styles.pilotNote}>Phase 3 · Read-only pilot</Text>
    </View>
  );
}

function DesktopTopNavigation({ pathname }: { pathname: string }) {
  return (
    <View style={styles.topNavigation}>
      <View style={styles.compactBrand}>
        <View style={styles.brandMark}><Text style={styles.brandMarkText}>D</Text></View>
        <Text style={styles.brandName}>DAVE</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.topNavigationLinks}>
        {desktopNavigationItems.map(item => (
          <DesktopNavigationLink key={item.href} pathname={pathname} item={item} compact />
        ))}
      </ScrollView>
    </View>
  );
}

function DesktopNavigationLink({
  pathname,
  item,
  compact = false,
}: {
  pathname: string;
  item: (typeof desktopNavigationItems)[number];
  compact?: boolean;
}) {
  const active = desktopRouteIsActive(pathname, item.href);
  return (
    <Link href={item.href} asChild>
      <Pressable
        style={({ pressed }) => [
          compact ? styles.topNavigationLink : styles.navigationLink,
          active && styles.navigationLinkActive,
          pressed && styles.navigationLinkPressed,
        ]}
        accessibilityRole="link"
        accessibilityState={{ selected: active }}
      >
        <Text style={[styles.navigationLabel, active && styles.navigationLabelActive]}>{item.label}</Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: '100%', backgroundColor: '#F3F5F9' },
  rootWide: { flexDirection: 'row' },
  scroll: { flex: 1 },
  content: { width: '100%', maxWidth: 1540, alignSelf: 'center', padding: spacing.xl, gap: spacing.xl },
  sidebar: { width: 258, minHeight: '100%', backgroundColor: '#FFFFFF', borderRightWidth: 1, borderRightColor: '#D9DFEA', padding: spacing.lg, gap: spacing.xxl },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  compactBrand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingRight: spacing.md },
  brandMark: { width: 42, height: 42, borderRadius: 12, backgroundColor: '#087EF5', alignItems: 'center', justifyContent: 'center' },
  brandMarkText: { color: '#FFFFFF', fontSize: 22, fontWeight: '900' },
  brandName: { color: '#171A21', fontSize: 17, fontWeight: '900', letterSpacing: 0.4 },
  brandSubtitle: { color: '#6F7480', fontSize: 12, lineHeight: 16, fontWeight: '700' },
  navigation: { gap: spacing.xs },
  navigationLink: { minHeight: 48, borderRadius: 12, justifyContent: 'center', paddingHorizontal: spacing.md },
  topNavigationLink: { minHeight: 42, borderRadius: 12, justifyContent: 'center', paddingHorizontal: spacing.md },
  navigationLinkActive: { backgroundColor: '#E7F2FF' },
  navigationLinkPressed: { opacity: 0.72 },
  navigationLabel: { color: '#5C6370', fontSize: 14, lineHeight: 20, fontWeight: '800' },
  navigationLabelActive: { color: '#0874DF' },
  pilotNote: { color: '#727886', fontSize: 12, lineHeight: 17, marginTop: 'auto' },
  topNavigation: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D9DFEA', borderRadius: 16, padding: spacing.sm, flexDirection: 'row', alignItems: 'center' },
  topNavigationLinks: { gap: spacing.xs, alignItems: 'center' },
  topRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.lg },
  titleBlock: { flex: 1, minWidth: 280, maxWidth: 820 },
  eyebrow: { color: '#0874DF', fontSize: 12, lineHeight: 17, fontWeight: '900', letterSpacing: 1.6 },
  title: { color: '#171A21', fontSize: 38, lineHeight: 44, fontWeight: '900', marginTop: spacing.xs },
  description: { color: '#666D79', fontSize: 17, lineHeight: 25, marginTop: spacing.sm },
  readOnlyBadge: { borderRadius: 999, backgroundColor: '#E7F2FF', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  readOnlyBadgeText: { color: '#0874DF', fontSize: 12, lineHeight: 16, fontWeight: '900', letterSpacing: 0.8 },
  safetyBanner: { borderRadius: 18, borderWidth: 1, borderColor: '#F1C36D', backgroundColor: '#FFF7E7', padding: spacing.lg, gap: spacing.xs },
  safetyTitle: { color: '#694900', fontSize: 17, lineHeight: 23, fontWeight: '900' },
  safetyDetail: { color: '#745B21', fontSize: 14, lineHeight: 21, maxWidth: 900 },
  cardGrid: { gap: spacing.lg },
  cardGridWide: { flexDirection: 'row', flexWrap: 'wrap' },
  card: { minHeight: 168, flexGrow: 1, flexBasis: 300, borderRadius: 20, borderWidth: 1, borderColor: '#D9DFEA', backgroundColor: '#FFFFFF', padding: spacing.xl, gap: spacing.sm },
  cardTitle: { color: '#1B1F27', fontSize: 19, lineHeight: 25, fontWeight: '900' },
  cardDetail: { color: '#686F7C', fontSize: 15, lineHeight: 23 },
});
