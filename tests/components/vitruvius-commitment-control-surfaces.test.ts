import fs from 'fs';
import path from 'path';

describe('Vitruvius commitment control surfaces', () => {
  const root = path.resolve(__dirname, '../..');
  const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
  const desktopOverview = fs.readFileSync(
    path.join(root, 'components/web-shell/desktop-overview-page.tsx'),
    'utf8',
  );
  const reports = fs.readFileSync(path.join(root, 'screens/ReportsScreen.tsx'), 'utf8');

  it('uses the shared commitment model on mobile and desktop overview', () => {
    expect(app).toContain("from './services/VitruviusCommitmentControl'");
    expect(app).toContain('const commitmentControl = buildVitruviusCommitmentControl({');
    expect(app).toContain('>Current Focus</Text>');
    expect(app).toContain("{currentFocus.decisionNeeded}");
    expect(app).toContain("{currentFocus.proofNeeded}");

    expect(desktopOverview).toContain("from '../../services/VitruviusCommitmentControl'");
    expect(desktopOverview).toContain('const commitmentControl = buildVitruviusCommitmentControl({');
    expect(desktopOverview).toContain('<SectionHeading title="Current Focus" />');
    expect(desktopOverview).toContain('{item.decisionNeeded}');
    expect(desktopOverview).toContain('{item.proofNeeded}');
  });

  it('uses the shared commitment model for report management actions', () => {
    expect(reports).toContain("from '../services/VitruviusCommitmentControl'");
    expect(reports).toContain('const commitmentControl = useMemo(() => buildVitruviusCommitmentControl({');
    expect(reports).toContain('Management actions');
    expect(reports).toContain('{item.recoveryAction}');
    expect(reports).toContain('Owner: {item.owner} · {item.timing}');
    expect(reports).not.toContain('Management commitments to confirm');
  });

  it('keeps the change inside existing Overview, Tasks, and Reports navigation', () => {
    expect(app).not.toContain("label: 'Commitment Control'");
    expect(desktopOverview).not.toContain("pathname: '/commitments'");
    expect(reports).not.toContain("title=\"Commitment Control\"");
  });
});
