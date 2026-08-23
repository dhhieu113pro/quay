import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../docs/index.html', import.meta.url), 'utf8');

test('Quay page shows submitted Microsoft Store state and can switch to a live Store link', () => {
  assert.match(html, /Submitted to Microsoft Store/);
  assert.match(html, /Coming soon/);
  assert.match(html, /const microsoftStoreUrl\s*=\s*['"][^'"]*['"]/);
  assert.match(html, /Get it from Microsoft Store/);
});
