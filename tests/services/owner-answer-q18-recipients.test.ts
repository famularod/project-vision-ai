const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

// Owner answer Q18 (30 Sep 2026), from audit A3 pass 2 M2: nothing in the app
// sends a field update to its recipients (sendEmail/sendText and the
// recipient check are never called), so the wording no longer promises it.
describe('recipients are described as kept with the update, not sent to', () => {
  it('the Recipients row says the app does not send to them', () => {
    expect(app).toContain('Optional · kept with the update; the app does not send it to them');
    expect(app).not.toContain("'Add recipients before sending'");
  });

  it('Needs Attention no longer asks for recipients, and a ready update is reviewed, not sent', () => {
    expect(app).not.toContain("title: 'Missing recipients'");
    expect(app).not.toContain('Open the update to review recipients and send.');
    expect(app).toContain("detail: 'Open the update to review it.',");
  });

  it('the send paths it describes are still unused (a reason to relabel rather than build sending)', () => {
    expect(app.match(/\bsendEmail\(/g)).toHaveLength(1);
    expect(app.match(/\bminimumSendDataIssue\(/g)).toHaveLength(1);
  });
});
