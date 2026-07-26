import {
  normalizeScheduleImport,
  parseScheduleDelimitedText,
} from '../../services/PIEScheduleIntelligence';

const header = 'Task,Project,Area,Start,Finish,Milestone,Owner,Status,Notes';
const now = new Date('2026-07-18T12:00:00-07:00');

function importCsv(dataRow: string, customHeader = header) {
  return normalizeScheduleImport({
    contents: `${customHeader}\r\n${dataRow}`,
    sourceName: 'schedule.csv',
    mimeType: 'text/csv',
    now,
  });
}

describe('RFC 4180 schedule CSV parsing', () => {
  it('keeps quoted commas in one field', () => {
    const parsed = parseScheduleDelimitedText(
      `${header}\r\n"Install lights, phase 1",2375 Compliance Project,Canopy A,07/18/2026,07/24/2026,,,In Progress,`,
    );

    expect(parsed.issues).toEqual([]);
    expect(parsed.rows[1][0]).toBe('Install lights, phase 1');

    const result = importCsv(
      '"Install lights, phase 1",2375 Compliance Project,Canopy A,07/18/2026,07/24/2026,,,In Progress,',
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].taskName).toBe('Install lights, phase 1');
  });

  it('treats CRLF as one record boundary', () => {
    const parsed = parseScheduleDelimitedText(
      'Task,Project,Area\r\nTask A,Project A,Area A\r\nTask B,Project B,Area B\r\n',
    );

    expect(parsed.rows).toEqual([
      ['Task', 'Project', 'Area'],
      ['Task A', 'Project A', 'Area A'],
      ['Task B', 'Project B', 'Area B'],
    ]);
  });

  it('does not split slash-form dates into extra schedule records', () => {
    const result = importCsv(
      'Install wall packs,2375 Compliance Project,Canopy A,07/18/2026,07/24/2026,,,In Progress,',
    );

    expect(result.parseIssues).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      startDate: 'Jul 18, 2026',
      finishDate: 'Jul 24, 2026',
    }));
  });

  it('preserves line breaks inside quoted cells', () => {
    const parsed = parseScheduleDelimitedText(
      `${header}\r\nInstall wall packs,2375 Compliance Project,Canopy A,07/18/2026,07/24/2026,,,In Progress,"Coordinate shutdown\r\nwith facilities."`,
    );
    const result = importCsv(
      'Install wall packs,2375 Compliance Project,Canopy A,07/18/2026,07/24/2026,,,In Progress,"Coordinate shutdown\r\nwith facilities."',
    );

    expect(parsed.rows[1][8]).toBe('Coordinate shutdown\r\nwith facilities.');
    expect(result.parseIssues).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].notes).toBe('Coordinate shutdown with facilities.');
  });

  it('removes a UTF-8 BOM before matching header names', () => {
    const result = normalizeScheduleImport({
      contents: `\uFEFF${header}\nInstall wall packs,2375 Compliance Project,Canopy A,07/18/2026,07/24/2026,,,In Progress,`,
      sourceName: 'schedule.csv',
      mimeType: 'text/csv',
      now,
    });

    expect(result.parseIssues).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].taskName).toBe('Install wall packs');
  });

  it('unescapes doubled quotes in quoted cells', () => {
    const result = importCsv(
      '"Install ""A"" lights",2375 Compliance Project,Canopy A,07/18/2026,07/24/2026,,,In Progress,',
    );

    expect(result.parseIssues).toEqual([]);
    expect(result.items[0].taskName).toBe('Install "A" lights');
  });

  it('preserves empty cells and trailing empty cells', () => {
    const parsed = parseScheduleDelimitedText('Task,,Area,,,');

    expect(parsed.issues).toEqual([]);
    expect(parsed.rows).toEqual([['Task', '', 'Area', '', '', '']]);

    const result = importCsv(
      'Install wall packs,,Canopy A,,07/24/2026,,,,',
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      projectName: '',
      locationName: 'Canopy A',
      finishDate: 'Jul 24, 2026',
    }));
  });

  it('reports malformed quoting and column counts instead of silently accepting them', () => {
    const unterminated = importCsv(
      '"Install wall packs,2375 Compliance Project,Canopy A,07/18/2026,07/24/2026,,,In Progress,',
    );
    expect(unterminated.parseIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'unterminated_quote',
        row: 2,
        column: 1,
      }),
      expect.objectContaining({
        code: 'column_count_mismatch',
        row: 2,
      }),
    ]));
    expect(unterminated.reviewItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        task: 'Review imported schedule row 2',
        confidence: 'low',
      }),
    ]));
    expect(unterminated.importStatus).not.toBe('Import Successful');
    expect(unterminated.message).toContain('delimited row issues need review');

    const unexpectedQuote = parseScheduleDelimitedText('Task\nInstall "A" lights');
    expect(unexpectedQuote.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'unexpected_quote',
        row: 2,
        column: 1,
      }),
    ]));
    expect(unexpectedQuote.issues).toHaveLength(2);
  });
});
