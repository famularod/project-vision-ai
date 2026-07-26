import fs from 'fs';
import path from 'path';

describe('Vitruvius web workspace design contract', () => {
  const root = path.resolve(__dirname, '../..');
  const shell = fs.readFileSync(
    path.join(root, 'components/web-shell/desktop-read-only-shell.tsx'),
    'utf8',
  );
  const surfaces = fs.readFileSync(
    path.join(root, 'components/web-shell/desktop-surface-palette.ts'),
    'utf8',
  );

  it('uses the shared summary pattern on operational pages', () => {
    expect(shell).toContain('function WorkspaceSummary');
    expect(shell).toContain('function FieldActivityWorkspace');
    expect(shell).toContain('function PhotoWorkspace');
    expect(shell).toContain("label: 'Total Tasks'");
    expect(shell).toContain("label: 'Field Updates'");
    expect(shell).toContain("label: 'Current Schedule'");
  });

  it('keeps the existing task and document controls available', () => {
    expect(shell).toContain('>Add Task</Text>');
    expect(shell).toContain("uploadOpen ? 'Close Upload' : 'Upload Document'");
    expect(shell).toContain("'Make Current Schedule'");
    expect(shell).toContain('>Delete</Text>');
  });

  it('provides a searchable document library with a persistent inspector', () => {
    expect(shell).toContain('placeholder="Search document, project, category, note, or file name"');
    expect(shell).toContain('accessibilityLabel="Search project documents"');
    expect(shell).toContain('function DocumentDetailsPanel');
    expect(shell).toContain('title="Select a document"');
    expect(shell).toContain('Showing {visibleDocuments.length} of {documents.length} project documents');
    expect(shell).toContain("label=\"Category\"");
    expect(shell).toContain('Current schedule · protected from deletion');
    expect(shell).toContain('styles.documentListCard');
  });

  it('provides a searchable task workspace with persistent task details', () => {
    expect(shell).toContain('placeholder="Search task, project, area, owner, or contractor"');
    expect(shell).toContain('function TaskFilterSelect');
    expect(shell).toContain("label=\"Status\"");
    expect(shell).toContain("label=\"Area\"");
    expect(shell).toContain("label=\"Priority\"");
    expect(shell).toContain('function TaskDetailsPanel');
    expect(shell).toContain('function TaskInspectorEmpty');
    expect(shell).toContain('>View details</Text>');
    expect(shell).toContain('>Edit Task</Text>');
    expect(shell).toContain('styles.taskWorkspaceBody');
    expect(shell).toContain('styles.taskInspectorPane');
    expect(shell).toContain('compactTaskWorkspace && styles.taskInspectorPaneCompact');
  });

  it('provides searchable field activity with a persistent update inspector', () => {
    expect(shell).toContain('placeholder="Search project, area, task, note, or photo"');
    expect(shell).toContain('accessibilityLabel="Search field activity"');
    expect(shell).toContain('function FieldActivityDetailsPanel');
    expect(shell).toContain('title="Select a field update"');
    expect(shell).toContain('>View update</Text>');
    expect(shell).toContain('Showing {visibleUpdates.length} of {updates.length} field updates');
  });

  it('provides filtered photo review with honest chronological context', () => {
    expect(shell).toContain('placeholder="Search project, area, task, caption, or note"');
    expect(shell).toContain('function PhotoDetailsPanel');
    expect(shell).toContain('function priorComparablePhotoFor');
    expect(shell).toContain('candidate.update.id === selected.update.id');
    expect(shell).toContain('candidateTime < selectedTime');
    expect(shell).toContain('no visual change is assumed');
    expect(shell).toContain('This photo is shown as a baseline, not a comparison.');
    expect(shell).toContain('title="Select a project photo"');
  });

  it('shows a readable report preview before exposing the raw editor', () => {
    expect(shell).toContain("const [editingReportBody, setEditingReportBody] = useState(false)");
    expect(shell).toContain('editingReportBody ? (');
    expect(shell).toContain('>Report preview</Text>');
    expect(shell).toContain("reportFactsAreCurrent ? 'Ready for review' : 'Refresh required'");
    expect(shell).toContain('>Save Draft</Text>');
    expect(shell).toContain('>Approve Report</Text>');
  });

  it('leads reports with PM facts, risks, decisions, and next actions', () => {
    expect(shell).toContain('>CURRENT PROJECT CONDITION</Text>');
    expect(shell).toContain('title="Current work"');
    expect(shell).toContain('title="What changed"');
    expect(shell).toContain('title="Schedule position"');
    expect(shell).toContain('title="Risks and decisions"');
    expect(shell).toContain('>Next actions</Text>');
    expect(shell).toContain("composerOpen ? 'Close Report Workspace' : 'Review & Prepare Report'");
    expect(shell).toContain('Based on {report.sourceTaskIds.length} tasks and {report.sourceUpdateIds.length} field updates');
    expect(shell).not.toContain('Each saved artifact keeps its exact source refresh');
  });

  it('uses PM-facing activity language', () => {
    expect(shell).toContain('The newest field records appear first, with project, area, task, notes, and photo context kept together.');
    expect(shell).toContain('No field note was added.');
    expect(shell).not.toContain('Newest source-backed updates appear first.');
  });

  it('presents Projects as an actionable portfolio workspace', () => {
    expect(shell).toContain('function ProjectsWorkspace');
    expect(shell).toContain('function ProjectPortfolioCard');
    expect(shell).toContain("label: 'Due 7 Days'");
    expect(shell).toContain('>Open Project</Text>');
    expect(shell).toContain('>View Tasks</Text>');
    expect(shell).not.toContain('Archived projects are excluded from the pilot.');
  });

  it('presents Settings as a clear sync and data-safety workspace', () => {
    expect(shell).toContain('function SettingsWorkspace');
    expect(shell).toContain('const freshness = presentDAVEWebFreshness(auth.freshness)');
    expect(shell).toContain('{freshness.title}</Text>');
    expect(shell).toContain('label={freshness.badge}');
    expect(shell).toContain('>This computer</Text>');
    expect(shell).toContain('>iPhone and iPad</Text>');
    expect(shell).toContain('>Sync Now</Text>');
    expect(shell).toContain("'Run Data Check'");
    expect(shell).toContain('Checking Shared Record…');
    expect(shell).toContain('>Data check complete</Text>');
    expect(shell).toContain('accessibilityLabel="Run shared record data check"');
    expect(shell).toContain('>Download Data Export</Text>');
    expect(shell).toContain("restorePhrase !== 'RESTORE MISSING TASKS'");
  });

  it('keeps the web workspace responsive without duplicating pages', () => {
    expect(shell).toContain('desktopWorkspaceLayout(width)');
    expect(shell).toContain('compactContent && styles.contentCompact');
    expect(shell).toContain('page !== \'settings\'');
    expect(shell).toContain('styles.contextBar');
    expect(shell).toContain('styles.contextUtilities');
    expect(shell).toContain("portfolioGrid: { flexDirection: 'row', flexWrap: 'wrap'");
    expect(shell).toContain("syncGuideGrid: { flexDirection: 'row', flexWrap: 'wrap'");
    expect(shell).toContain("workspaceSummary: { flexDirection: 'row', flexWrap: 'wrap'");
  });

  it('keeps implementation details out of the everyday workspace', () => {
    expect(shell).not.toContain('Live cloud refresh · 12-second backup check');
    expect(shell).not.toContain('Cloud data last confirmed');
    expect(shell).not.toContain('Session expires');
  });

  it('lets operational cards shrink safely at 320–390px without horizontal overflow', () => {
    expect(shell).toContain("contentCompact: { padding: spacing.sm");
    expect(shell).toContain("titleBlock: { flex: 1, minWidth: 0");
    expect(shell).toContain("portfolioCard: { flexGrow: 1, flexBasis: 520, minWidth: 0");
    expect(shell).toContain("evidenceCard: { flexGrow: 1, flexBasis: 430, minWidth: 0");
    expect(shell).toContain("photoCard: { flexGrow: 1, flexBasis: 340, minWidth: 0");
    expect(shell).toContain("reportPreviewColumn: { flexGrow: 1, flexBasis: 620, minWidth: 0");
  });

  it('exposes protected artifacts and accessible form names without mislabeling documents', () => {
    expect(shell).toContain("auth.getArtifactUrl('project-photos'");
    expect(shell).toContain("auth.getArtifactUrl('project-documents'");
    expect(shell).toContain('accessibilityLabel={`${label}, custom value`}');
    expect(shell).toContain("'aria-label': label");
    expect(shell).toContain("if (kind === 'prior') return 'Prior version'");
    expect(shell).toContain("return 'Document'");
  });

  it('uses the Option A Cool Blueprint surface hierarchy', () => {
    expect(surfaces).toContain("canvas: '#F4F8FD'");
    expect(surfaces).toContain("sidebar: '#FFFFFF'");
    expect(surfaces).toContain("section: '#EEF5FC'");
    expect(surfaces).toContain("card: '#FFFFFF'");
    expect(surfaces).toContain("borderStrong: '#B8CDE3'");
    expect(surfaces).toContain("accent: '#087EF5'");
    expect(surfaces).toContain("hero: '#087EF5'");
    expect(surfaces).toContain("dataHeader: '#194A91'");
    expect(shell).toContain('backgroundColor: desktopSurfaces.canvas');
    expect(shell).toContain('backgroundColor: desktopSurfaces.sidebar');
    expect(shell).toContain('backgroundColor: desktopSurfaces.section');
    expect(shell).toContain('backgroundColor: desktopSurfaces.card');
    expect(shell).toContain('borderLeftColor: desktopSurfaces.accent');
    expect(shell).toContain("workspaceMetric: { flexGrow: 1, flexBasis: 180, minHeight: 78");
    expect(shell).toContain('backgroundColor: desktopSurfaces.sectionStrong');
    expect(shell).toContain('boxShadow: desktopSurfaces.shadow');
    expect(shell).toContain('boxShadow: desktopSurfaces.sidebarShadow');
  });

  it('presents desktop tasks as collapsible project and area groups', () => {
    expect(shell).toContain('Tasks by project and area');
    expect(shell).toContain('Select an area to show its tasks.');
    expect(shell).toContain('>Expand all</Text>');
    expect(shell).toContain('>Collapse all</Text>');
    expect(shell).toContain('accessibilityState={{ expanded: projectExpanded }}');
    expect(shell).toContain('accessibilityState={{ expanded: areaExpanded }}');
    expect(shell).toContain('taskProjectGroup');
    expect(shell).toContain('taskAreaContent');
    expect(shell).toContain("taskProjectGroup: { borderRadius: 16, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.cardMuted");
    expect(shell).toContain("taskGroup: { borderRadius: 13, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.card");
    expect(shell).toContain('backgroundColor: desktopSurfaces.selected');
  });
});
