// Garante que todo `import { x } from './js/y.js'` aponta para algo que y.js
// realmente exporta. app.js e js/dialogs.js não rodam fora do navegador, então
// este teste lê o código-fonte em vez de importá-lo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const files = ['app.js', ...readdirSync(join(root, 'js')).filter(f => f.endsWith('.js')).map(f => `js/${f}`)];
const source = f => readFileSync(join(root, f), 'utf8');

function exportsOf(code) {
  const names = new Set();
  for (const m of code.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of code.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name) names.add(name);
    }
  }
  return names;
}

test('todo import nomeado de módulo local tem export correspondente', () => {
  const problems = [];
  for (const file of files) {
    const code = source(file);
    for (const m of code.matchAll(/^import\s*\{([^}]*)\}\s*from\s*'(\.[^']+)'/gm)) {
      const target = join(dirname(file), m[2]).replaceAll('\\', '/');
      const available = exportsOf(source(target));
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0];
        if (name && !available.has(name)) problems.push(`${file}: '${name}' não é exportado por ${target}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});
