// Gera SYSTEM-MAP.md: o mapa do projeto (arquivos, módulos, funções, estado, CSS e por onde
// começar cada tipo de mudança). Rode depois de mexer no código:
//
//   node scripts/system-map.mjs
//
// O objetivo é dar o caminho curto para achar as coisas: em vez de varrer app.js de 4 mil
// linhas, o mapa diz o arquivo, a linha e quem chama quem.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const lines = (rel) => read(rel).split(/\r?\n/);
const count = (rel) => lines(rel).length;

// ---------- app.js: funções de topo, imports e chaves de armazenamento ----------
const appLines = lines('app.js');
const funcoes = [];
appLines.forEach((linha, i) => {
  const m = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(linha);
  if (m) funcoes.push({ nome: m[1], linha: i + 1 });
  else {
    const c = /^const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(?[^=]*=>/.exec(linha);
    if (c) funcoes.push({ nome: c[1], linha: i + 1 });
  }
});

const imports = appLines
  .map((l, i) => ({ l, i: i + 1 }))
  .filter(({ l }) => /^import\s/.test(l) || /^\s+\w+[,\s}]/.test(l) && false);
const storage = [...new Set(appLines.join('\n').match(/(?:localStorage\.(?:get|set|remove)Item\(\s*|STORAGE\s*=\s*)'([^']+)'/g) || [])]
  .map((s) => s.replace(/^[^']*'/, '').replace(/'$/, ''));

// ---------- js/: exports, imports e tamanho ----------
const jsFiles = readdirSync(join(root, 'js')).filter((f) => f.endsWith('.js')).sort();
const modulos = jsFiles.map((f) => {
  const ls = lines(`js/${f}`);
  const exports = ls
    .map((l, i) => {
      const m = /^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/.exec(l);
      return m ? `${m[1]}:${i + 1}` : null;
    })
    .filter(Boolean);
  const deps = [...new Set((read(`js/${f}`).match(/from\s+'\.\/([\w.-]+)'/g) || []).map((s) => s.replace(/from\s+'\.\/|'/g, '')))];
  return { arquivo: `js/${f}`, linhas: ls.length, exports, deps };
});

// ---------- CSS: seções do tema (macos.css) e regras que forçam especificidade ----------
const secoesCss = (rel) => {
  const ls = lines(rel);
  const out = [];
  ls.forEach((l, i) => {
    const m = /^\/\*\s*=+\s*$/.test(l.trim()) && ls[i + 1] ? ls[i + 1] : null;
    if (m && /^\s{3}\S/.test(m)) {
      const titulo = m.replace(/^\s+|\s+$/g, '');
      if (!titulo.startsWith('=') && titulo.length > 3) out.push({ titulo, linha: i + 1 });
    }
  });
  return out;
};
const hacks = lines('macos.css')
  .map((l, i) => (/not\(#\\9\)/.test(l) ? i + 1 : null))
  .filter(Boolean);

// ---------- index.html: pontos de montagem ----------
const htmlLines = lines('index.html');
const idsPrincipais = htmlLines
  .map((l, i) => {
    const m = /id="([\w-]+)"/.exec(l);
    return m ? { id: m[1], linha: i + 1 } : null;
  })
  .filter(Boolean);
const marcos = [
  'class="topbar"',
  'class="sidebar left"',
  'class="sidebar right"',
  'id="canvasWrap"',
  'id="heatControl"',
  'id="quickSearchModal"',
];
const marcosLinhas = marcos
  .map((m) => {
    const idx = htmlLines.findIndex((l) => l.includes(m));
    return idx >= 0 ? { marco: m.replace(/class="|id="|"/g, ''), linha: idx + 1 } : null;
  })
  .filter(Boolean);

// ---------- grafo de dependências (Mermaid) ----------
const nodeId = (nome) => String(nome).replace(/[^\w]/g, '_');
const depsDoApp = [...new Set((read('app.js').match(/from '\.\/js\/([\w.-]+)'/g) || []).map((s) => s.replace(/from '\.\/js\/|'/g, '')))];
const grafo = [
  '```mermaid',
  'graph LR',
  '  index[index.html] --> app[app.js]',
  '  index --> css1[app.css] --> css2[macos.css]',
  ...depsDoApp.map((d) => `  app --> ${nodeId(d)}["${d}"]`),
  ...modulos.flatMap((m) =>
    m.deps
      .filter((d) => d.endsWith('.js'))
      .map((d) => `  ${nodeId(m.arquivo.replace(/^js\//, ''))} --> ${nodeId(d)}["${d}"]`)
  ),
  '```',
].join('\n');

// ---------- grupos de funções do app.js ----------
const grupos = [
  ['Render / pintura', /^(render|refresh|update|fitBayface|centerOnPoint)/],
  ['Ligações de UI (setup/bind)', /^(setup|bind)/],
  ['Criação e edição de dados', /^(add|create|delete|remove|resize|apply|assign|duplicate|move|merge)/],
  ['Busca', /search/i],
  ['Cálculos (geometria/rota)', /^(calc|compute|geometry|route|tray|row|rack(?!Display))/],
  ['Cascas e modais', /(Modal|Panel|Overlay)$/],
];
const porGrupo = grupos.map(([titulo, re]) => ({
  titulo,
  itens: funcoes.filter((f) => re.test(f.nome)),
}));
const sobra = funcoes.filter((f) => !grupos.some(([, re]) => re.test(f.nome)));

const tab = (linhas, cabecalho) =>
  [cabecalho, ...linhas].join('\n');

const md = `# SYSTEM-MAP — mapa do projeto

Gerado por \`node scripts/system-map.mjs\`. **Rode o script depois de mexer no código** para o
mapa continuar valendo (ele lê as linhas de verdade, não é escrito à mão).

Última geração: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · app.js com ${count('app.js')} linhas · ${jsFiles.length} módulos em js/ · app.css ${count('app.css')} · macos.css ${count('macos.css')}

## 1. O que é o quê

| arquivo | papel |
|---|---|
| index.html | casca: barra de topo, duas laterais flutuantes, canvas, barra inferior e todos os modais |
| app.js | orquestra tudo: estado, render, interação do canvas e das laterais (\`${count('app.js')}\` linhas) |
| js/state.js | objeto \`state\` compartilhado (fonte da verdade em memória) |
| js/geometry.js | posições físicas de fileira/rack/calha + rótulo do rack (\`rackDisplayName\`, \`findRackByLabel\`) |
| js/routing.js | grafo de rota e cálculo de metragem de cabo |
| js/occupancy.js | ocupação de U por face, conflito e posição de asset |
| js/cables.js | lista de cabos, import/export XLSX e painel do cabo |
| js/catalogs.js | cadastros (tipos, fabricantes, modelos, salas) |
| js/bulk-assets.js + js/inventory-import.js | edição em massa e importação de planilha de assets |
| js/cloud-sync.js | salvar/carregar projeto na nuvem + status "Salvo" |
| js/rack-metrics.js | métricas do mapa de calor/resumo, sem DOM |
| app.css | camada base de estilo (tema claro e escuro por variáveis) |
| macos.css | camada de acabamento, **carregada depois do app.css** — quando as duas definem a mesma coisa, vale esta |

## 2. Módulos de js/ (exports e dependências)

${grafo}

${tab(
  modulos.map(
    (m) =>
      `| \`${m.arquivo}\` | ${m.linhas} | ${m.exports.slice(0, 8).join(', ')}${m.exports.length > 8 ? ', …' : ''} | ${m.deps.join(', ') || '—'} |`
  ),
  '| módulo | linhas | exporta (nome:linha) | importa de |\n|---|---|---|---|'
)}

## 3. app.js — funções por área

${porGrupo
  .map(
    ({ titulo, itens }) =>
      `### ${titulo}\n\n${itens.length ? itens.map((f) => `\`${f.nome}\` (${f.linha})`).join(' · ') : '—'}\n`
  )
  .join('\n')}
### Outras

${sobra.length ? sobra.slice(0, 60).map((f) => `\`${f.nome}\` (${f.linha})`).join(' · ') : '—'}

## 4. Onde mexer quando…

| quero mudar… | mexer em |
|---|---|
| divisão Propriedades × Cabos (arrasto) | \`setupPropSectionResize\` (app.js) — grava \`__dccpRightSplit\`; altura de cada um |
| recolher/expandir de um cartão | \`bindSectionCollapse\` + \`animateSectionCollapse\` (app.js) e \`.collapsed\` no macos.css |
| estética da barra de topo | bloco **"Barra de topo — estilo plano"**, no fim do macos.css (vence por vir depois) |
| busca da barra | \`searchableItems\`, \`searchListHtml\`, \`renderTopSearchResults\` (app.js) + \`#topSearchWrap\` no index.html |
| lista de cabos (linha, botão excluir) | \`renderCables\` em js/cables.js |
| nome do rack com a fileira (A-101) | \`rackDisplayName\` / \`findRackByLabel\` em js/geometry.js |
| exportar/importar planilha | js/inventory-import.js, \`exportAssetsXLSX\` (app.js), \`exportCablesXLSX\` (js/cables.js) |
| rotas e metragem do cabo | js/routing.js |
| ocupação de U / choque de posição | js/occupancy.js |
| salvar na nuvem e status | js/cloud-sync.js (\`setCloudStatus\`) |
| minimapa, zoom e barra inferior | \`setupPan\`, \`setupMinimap\`, \`.canvas-zoom-bar\` / \`.heat-control\` |

## 5. Estado e persistência

- \`state\` (js/state.js) guarda: \`rows\`, \`racks\`, \`trays\`, \`cables\`, \`assets\`, \`rooms\` (cada sala com \`data\`),
  catálogos, \`selected\` / \`multiSelected\` / \`trayMultiSelected\` e as medidas padrão (U, largura, profundidade…).
- O projeto vive na nuvem: \`save()\` (app.js) agenda o envio e a sala ativa é copiada para \`room.data\` por
  \`syncActiveRoom()\`.
- Chaves de \`localStorage\` usadas: ${storage.map((s) => `\`${s}\``).join(', ') || '—'} (mais \`dccp-collapse-<painel>\` e \`dccp-split-cabos\`).

## 6. index.html — pontos de montagem

| marco | linha |
|---|---|
${marcosLinhas.map((m) => `| ${m.marco} | ${m.linha} |`).join('\n')}

Ids (${idsPrincipais.length}) e suas linhas estão no fim deste arquivo, na seção 8.

## 7. CSS

### Seções do tema (macos.css)

${secoesCss('macos.css')
  .map((s) => `- ${s.titulo} — linha ${s.linha}`)
  .join('\n')}

Regras com \`:not(#\\9)\` (truque de especificidade para vencer o app.css): linhas
${hacks.slice(0, 30).join(', ')}${hacks.length > 30 ? ', …' : ''}.

## 8. Ids do index.html

${(() => {
  const blocos = [];
  for (let i = 0; i < idsPrincipais.length; i += 8) {
    blocos.push(idsPrincipais.slice(i, i + 8).map((x) => `\`${x.id}\` ${x.linha}`).join(' · '));
  }
  return blocos.join('\n\n');
})()}

## 9. Testes e verificação

- \`node --test "js/test/*.test.mjs"\` — ${readdirSync(join(root, 'js/test')).filter((f) => f.endsWith('.test.mjs')).length} arquivos de teste,
  cobrindo geometria, rota, ocupação, utilitários, versões e exportação da planta.
- \`node scripts/bump-version.mjs css\` — sobe a versão dos módulos e do CSS em index.html (cache do navegador).
- \`cmd /c "node --input-type=module --check < app.js"\` — checagem de sintaxe do app.js.
- \`node scripts/system-map.mjs\` — regenera este arquivo.

### Como eu meço mudanças de UI

Para qualquer mudança visual, subo o app no Edge headless com CDP (perfil temporário,
\`--allow-file-access-from-files\`), entro pelo modo convidado (\`#btnGuestMode\`), monto uma
estrutura pelo formulário (\`rowCount\` + \`defaultRacks\` + \`#btnBuildRows\` → \`#uiConfirmOk\`) e
meço o DOM (\`getBoundingClientRect\`) em vez de julgar pelo olho. Os scripts de medição ficam em
\`%TEMP%\\stratum-measure\\*\`. Para o tema claro, gravo \`dc-planner-theme-v3=light\` e recarrego.
`;

writeFileSync(join(root, 'SYSTEM-MAP.md'), md);
console.log(`SYSTEM-MAP.md gerado (${md.length} caracteres)`);
console.log(`app.js: ${funcoes.length} funções · js/: ${jsFiles.length} módulos · index.html: ${idsPrincipais.length} ids`);
