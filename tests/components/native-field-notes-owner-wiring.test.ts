import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('native Field Notes must not choose its durable inbox from online Layer4 identity', () => {
  const app = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8');
  const route = app.match(/<NativeFieldNotesExperience\b[\s\S]*?\/>/)?.[0];
  expect(route).toBeDefined();
  expect(route).not.toContain('layer4Identity');
  expect(route).not.toContain('ownerKey=');
});
