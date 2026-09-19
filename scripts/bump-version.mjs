// Sobe o número de versão dos arquivos do app em index.html.
//
//   node scripts/bump-version.mjs        -> app.js e todos os módulos de js/ (mesma versão)
//   node scripts/bump-version.mjs css    -> também app.css e macos.css
//
// Por que existe: o navegador guarda cada arquivo por até alguns minutos. Se app.js
// mudar de versão mas js/occupancy.js (importado por ele) vier do cache antigo, o app
// não carrega. O <script type="importmap"> do index.html manda todo módulo pedir a
// mesma versão de app.js, então basta rodar este script a cada publicação.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = join(root, 'index.html');
let html = readFileSync(indexPath, 'utf8');

const current = Number(/src="app\.js\?v=(\d+)"/.exec(html)?.[1]);
if (!Number.isFinite(current)) throw new Error('app.js?v=N não encontrado em index.html');
const next = current + 1;

const modules = readdirSync(join(root, 'js')).filter(f => f.endsWith('.js')).sort();
const map = { imports: Object.fromEntries(modules.map(f => [`./js/${f}`, `./js/${f}?v=${next}`])) };
const block = `<script type="importmap">\n${JSON.stringify(map, null, 2).replace(/^/gm, '      ')}\n    </script>`;

const mapRe = /<script type="importmap">[\s\S]*?<\/script>/;
if (!mapRe.test(html)) throw new Error('bloco <script type="importmap"> não encontrado em index.html');
html = html.replace(mapRe, block.replace(/^ {6}/, ''));
html = html.replace(/src="app\.js\?v=\d+"/, `src="app.js?v=${next}"`);

if (process.argv.includes('css')) {
  for (const name of ['app.css', 'macos.css']) {
    html = html.replace(new RegExp(`href="${name.replace('.', '\.')}\?v=(\d+)"`), (_, v) => `href="${name}?v=${Number(v) + 1}"`);
  }
}
writeFileSync(indexPath, html);
console.log(`JS: v${current} -> v${next} (${modules.length} módulos)${process.argv.includes('css') ? ' + CSS' : ''}`);
