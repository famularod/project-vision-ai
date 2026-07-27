import fs from 'fs';
import path from 'path';

describe('native project item workflow boundary', () => {
  const appSource = fs.readFileSync(
    path.resolve(__dirname, '../../App.tsx'),
    'utf8',
  );
  const updateBoundary = appSource.slice(
    appSource.indexOf('function updateScheduleItem'),
    appSource.indexOf('function deleteScheduleItem'),
  );
  const scheduleItemRow = appSource.slice(
    appSource.indexOf('function ScheduleItemRow'),
    appSource.indexOf('function scheduleWarningIsUserActionable'),
  );
  const projectItemEditorSource = fs.readFileSync(
    path.resolve(__dirname, '../../components/project-item-details.tsx'),
    'utf8',
  );

  it('validates every native task mutation before changing local or synced state', () => {
    expect(updateBoundary).toContain('resolveProjectItemWorkflowMutation({');
    expect(updateBoundary).toContain("Alert.alert('Workflow action required'");
    expect(updateBoundary.indexOf('resolveProjectItemWorkflowMutation({'))
      .toBeLessThan(updateBoundary.indexOf('scheduleItemsCurrentRef.current ='));
  });

  it('threads explicit workflow intent and does not use completion verification for structured records', () => {
    expect(scheduleItemRow).toContain('workflowRequest?: ProjectItemWorkflowMutationRequest');
    expect(scheduleItemRow).toContain('needsCompletionVerification && !isStructuredProjectItem');
    expect(projectItemEditorSource).toContain('onUpdate({}, {');
    expect(projectItemEditorSource).toContain('action: result.action');
    expect(appSource).toContain('onUpdate(item.id, next, workflowRequest)');
  });
});
