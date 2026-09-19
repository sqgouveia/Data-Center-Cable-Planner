// O index.html mapeia cada módulo de js/ para a mesma versão de app.js (importmap).
// Sem isso, um módulo antigo em cache pode ficar misturado com um app.js novo e o
// app deixa de carregar. Se este teste falhar: `node scripts/bump-version.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

test('todo módulo de js/ está no importmap com a mesma versão de app.js', () => {
  const version = /src="app\.js\?v=(\d+)"/.exec(html)?.[1];
  assert.ok(version, 'app.js?v=N não encontrado em index.html');
  const mapText = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(mapText, 'importmap não encontrado em index.html');
  const { imports } = JSON.parse(mapText);
  const modules = readdirSync(join(root, 'js')).filter(f => f.endsWith('.js')).sort();
  const expected = Object.fromEntries(modules.map(f => [`./js/${f}`, `./js/${f}?v=${version}`]));
  assert.deepEqual(imports, expected);
});

test('o importmap vem antes do script de módulo', () => {
  assert.ok(html.indexOf('type="importmap"') < html.indexOf('type="module"'));
});
