import ts from 'typescript';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

// Whole-app audit A6 pass 6 (30 Sep 2026): each report photo preview hydrated
// every photo of its update, so opening Reports on the iPad for six iPhone
// photos made 36 signing requests and 36 full-size downloads instead of 6.
// Compiled from App.tsx, with the recovery call counted.
function appInnerFunction(name: string): string {
  const start = app.indexOf(`\n  async function ${name}(`);
  if (start < 0) throw new Error(`App.tsx has no inner function ${name}`);
  const end = app.indexOf('\n  }\n', start);
  return app.slice(start + 1, end + 4);
}

type Photo = { id: string; uri: string };
type Update = { id: string; photos: Photo[] };

function resolverFor(updates: Update[], hydrate: (update: Update) => Promise<Update>) {
  const compiled = ts.transpileModule(
    `${appInnerFunction('resolveReportPhotoPreview')}\nmodule.exports = resolveReportPhotoPreview;`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText;
  const holder = { exports: null as unknown };
  new Function('module', 'activeSavedUpdates', 'hydrateRecoveredProjectUpdatePhotos', compiled)(holder, updates, hydrate);
  return holder.exports as (photoId: string) => Promise<string | null>;
}

describe('a report photo preview fetches only its own photo', () => {
  const update: Update = { id: 'u1', photos: ['a', 'b', 'c', 'd', 'e', 'f'].map(id => ({ id, uri: '' })) };

  it('six previews shown together recover six photos, not thirty-six', async () => {
    let recovered = 0;
    const hydrate = jest.fn(async (candidate: Update) => {
      recovered += candidate.photos.length;
      return { ...candidate, photos: candidate.photos.map(photo => ({ ...photo, uri: `file:///cache/${photo.id}.jpg` })) };
    });
    const resolve = resolverFor([update], hydrate);
    const uris = await Promise.all(update.photos.map(photo => resolve(photo.id)));
    expect(uris).toEqual(update.photos.map(photo => `file:///cache/${photo.id}.jpg`));
    expect(recovered).toBe(6);
    expect(hydrate.mock.calls.every(([candidate]) => candidate.photos.length === 1)).toBe(true);
  });

  it('returns nothing for a photo in no update, or when recovery fails', async () => {
    const resolve = resolverFor([update], async () => { throw new Error('offline'); });
    await expect(resolve('missing')).resolves.toBeNull();
    await expect(resolve('a')).resolves.toBeNull();
  });
});
