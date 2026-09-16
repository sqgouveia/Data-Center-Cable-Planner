# Front/Rear no bayface — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir cadastrar e visualizar equipamento montado na traseira do rack, com ocupação de U independente por face.

**Architecture:** A lógica de ocupação e conflito sai do `app.js` para um módulo puro `js/occupancy.js`, testável sob Node, seguindo o padrão de `js/geometry.js` e `js/routing.js`. O asset ganha o campo `face` (`'front'`/`'rear'`/`null`). O bayface ganha um alternador FRONT/REAR e renderiza a face oposta como camada fantasma. Cabos continuam sem campo de face: o alvo de uma ponta sempre foi o ID da porta, que é único.

**Tech Stack:** HTML/CSS/JavaScript puro, ES modules nativos, sem build step. Testes com `node:test` e `node:assert`, sem framework.

**Spec:** `docs/superpowers/specs/2026-09-16-bayface-front-rear-design.md`

## Global Constraints

- Sem build step: o que está no disco é o que roda. Não introduzir bundler, transpiler ou dependência npm.
- `js/*.js` são módulos puros: sem DOM, sem `toast`, sem `renderAll`. Só `app.js` toca DOM.
- `state` é singleton mutável: nunca reatribuir, só mutar propriedades.
- Strings de UI em pt-BR. Nomes de teste em inglês, seguindo os arquivos existentes.
- Comando de teste: `node --test "js/test/*.test.mjs"`.
- Valores internos de face são `'front'` e `'rear'`; os rótulos de UI são `Frente` e `Traseira`.
- Capacidade elétrica, peso e térmica somam o rack inteiro — nunca por face.

## Mudança de comportamento deliberada

Hoje `assetConflicts` não filtra assets arquivados, mas `assetAtRackU` e o bayface filtram. Resultado: uma U ocupada só por asset arquivado aparece livre no bayface, mas recusa o salvamento. Este plano faz as duas rotas concordarem — arquivado não ocupa nem conflita. É correção de inconsistência existente, feita de propósito, coberta por teste na Task 1.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `js/occupancy.js` | **novo.** Ocupação e conflito de U por face. Puro, recebe a lista de assets por parâmetro. |
| `js/test/occupancy.test.mjs` | **novo.** Testes do módulo. |
| `app.js` | Importa o módulo, remove as versões locais, adiciona `bayfaceFace`, migração, campo na modal, lote e importação. |
| `index.html` | Select de face na modal, coluna `Face` no lote. |
| `app.css` | Camada fantasma e botão alternador FRONT/REAR. |

---

### Task 1: Módulo js/occupancy.js

Cria o módulo e seus testes, ainda sem conectar ao `app.js`. Ao fim desta task o app continua funcionando exatamente como antes, porque nada ainda importa o módulo.

**Files:**
- Create: `js/occupancy.js`
- Test: `js/test/occupancy.test.mjs`

**Interfaces:**
- Consumes: `num` de `js/utils.js`.
- Produces: `isAssetArchived(asset)`, `assetOccupancy(asset)`, `assetsOnFace(assets, rackId, face)`, `assetAtRackU(assets, rackId, u, face)`, `assetsAtRackU(assets, rackId, u)`, `assetOwningPort(assets, portId)`, `assetConflicts(assets, asset, ignoreId)`, `occupiedUnits(assets, rackId, face)`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `js/test/occupancy.test.mjs`:

```js
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAssetArchived, assetOccupancy, assetsOnFace, assetAtRackU,
  assetsAtRackU, assetOwningPort, assetConflicts, occupiedUnits,
} from '../occupancy.js';

function asset(over = {}) {
  return {
    id: over.id || 'a1', rackId: 'rack1', face: 'front',
    uStart: 10, uHeight: 1, status: 'Instalado', ports: [], ...over,
  };
}

test('assetOccupancy spans uStart through uStart + uHeight - 1', () => {
  assert.deepEqual(assetOccupancy(asset({ uStart: 10, uHeight: 3 })), { start: 10, end: 12 });
  assert.deepEqual(assetOccupancy(asset({ uStart: 5, uHeight: 1 })), { start: 5, end: 5 });
});

test('assetOccupancy falls back to 1U at U1 for missing values', () => {
  assert.deepEqual(assetOccupancy({}), { start: 1, end: 1 });
});

test('two assets on the same U but opposite faces do not conflict', () => {
  const front = asset({ id: 'front', face: 'front', uStart: 40 });
  const rear = asset({ id: 'rear', face: 'rear', uStart: 40 });
  assert.equal(assetConflicts([front], rear), false);
});

test('two assets on the same U and the same face conflict', () => {
  const a = asset({ id: 'a', face: 'front', uStart: 40 });
  const b = asset({ id: 'b', face: 'front', uStart: 40 });
  assert.equal(assetConflicts([a], b), true);
});

test('partially overlapping ranges on the same face conflict', () => {
  const tall = asset({ id: 'tall', uStart: 10, uHeight: 3 });
  const short = asset({ id: 'short', uStart: 12, uHeight: 1 });
  assert.equal(assetConflicts([tall], short), true);
});

test('adjacent ranges on the same face do not conflict', () => {
  const lower = asset({ id: 'lower', uStart: 10, uHeight: 2 });
  const upper = asset({ id: 'upper', uStart: 12, uHeight: 1 });
  assert.equal(assetConflicts([lower], upper), false);
});

test('assetConflicts ignores the asset being edited', () => {
  const existing = asset({ id: 'same', uStart: 40 });
  assert.equal(assetConflicts([existing], existing, 'same'), false);
});

test('an archived asset neither occupies nor conflicts', () => {
  const archived = asset({ id: 'old', uStart: 40, status: 'Arquivado' });
  const fresh = asset({ id: 'new', uStart: 40 });
  assert.equal(isAssetArchived(archived), true);
  assert.equal(assetConflicts([archived], fresh), false);
  assert.equal(assetAtRackU([archived], 'rack1', 40, 'front'), null);
});

test('an asset with no rack never conflicts', () => {
  const stock = asset({ id: 'stock', rackId: null, face: null });
  const mounted = asset({ id: 'mounted', uStart: 40 });
  assert.equal(assetConflicts([mounted], stock), false);
});

test('assetsOnFace returns only the requested face of the requested rack', () => {
  const front = asset({ id: 'f', face: 'front' });
  const rear = asset({ id: 'r', face: 'rear' });
  const other = asset({ id: 'o', rackId: 'rack2', face: 'front' });
  const found = assetsOnFace([front, rear, other], 'rack1', 'front');
  assert.deepEqual(found.map(a => a.id), ['f']);
});

test('assetsOnFace returns an empty list when rackId is missing', () => {
  assert.deepEqual(assetsOnFace([asset()], null, 'front'), []);
});

test('assetAtRackU returns the asset on the requested face and ignores the opposite one', () => {
  const front = asset({ id: 'f', face: 'front', uStart: 40 });
  const rear = asset({ id: 'r', face: 'rear', uStart: 40 });
  assert.equal(assetAtRackU([front, rear], 'rack1', 40, 'front').id, 'f');
  assert.equal(assetAtRackU([front, rear], 'rack1', 40, 'rear').id, 'r');
  assert.equal(assetAtRackU([front], 'rack1', 40, 'rear'), null);
});

test('assetAtRackU matches any U inside a multi-U asset', () => {
  const tall = asset({ id: 'tall', uStart: 10, uHeight: 3 });
  assert.equal(assetAtRackU([tall], 'rack1', 11, 'front').id, 'tall');
  assert.equal(assetAtRackU([tall], 'rack1', 13, 'front'), null);
});

test('assetsAtRackU returns both faces, or just the one that is filled', () => {
  const front = asset({ id: 'f', face: 'front', uStart: 40 });
  const rear = asset({ id: 'r', face: 'rear', uStart: 40 });
  assert.deepEqual(assetsAtRackU([front, rear], 'rack1', 40).map(a => a.id), ['f', 'r']);
  assert.deepEqual(assetsAtRackU([front], 'rack1', 40).map(a => a.id), ['f']);
  assert.deepEqual(assetsAtRackU([front, rear], 'rack1', 41), []);
});

test('assetOwningPort finds the owner on either face', () => {
  const front = asset({ id: 'f', face: 'front', ports: [{ id: 'p1', label: 'eth0' }] });
  const rear = asset({ id: 'r', face: 'rear', ports: [{ id: 'p2', label: 'C13-1' }] });
  assert.equal(assetOwningPort([front, rear], 'p2').id, 'r');
  assert.equal(assetOwningPort([front, rear], 'p1').id, 'f');
  assert.equal(assetOwningPort([front, rear], 'nope'), null);
  assert.equal(assetOwningPort([front, rear], null), null);
});

test('occupiedUnits counts only the requested face', () => {
  const front = asset({ id: 'f', face: 'front', uStart: 10, uHeight: 2 });
  const rear = asset({ id: 'r', face: 'rear', uStart: 20, uHeight: 1 });
  assert.deepEqual([...occupiedUnits([front, rear], 'rack1', 'front')].sort((a, b) => a - b), [10, 11]);
  assert.deepEqual([...occupiedUnits([front, rear], 'rack1', 'rear')], [20]);
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node --test "js/test/occupancy.test.mjs"`
Expected: FAIL — `Cannot find module` apontando para `../occupancy.js`, porque o módulo ainda não existe.

- [ ] **Step 3: Escrever o módulo**

Criar `js/occupancy.js`:

```js
// Ocupação física de rack, por face. Duas faces do mesmo rack têm ocupação
// independente: cabe um asset na frente e outro atrás da mesma U.
//
// Puro de propósito, no mesmo espírito de geometry.js: recebe a lista de
// assets por parâmetro em vez de ler `state`, e não toca DOM. É o que permite
// testar a regra "mesma face conflita, faces opostas não" sob Node — regra que
// vale em quatro caminhos independentes (bayface, modal, lote, importação) e
// que quebra em silêncio se um deles esquecer o filtro.
import { num } from './utils.js';

export function isAssetArchived(asset) {
  return String(asset?.status || '') === 'Arquivado';
}

export function assetOccupancy(asset) {
  const start = Math.floor(num(asset?.uStart, 1));
  const height = Math.max(1, Math.floor(num(asset?.uHeight, 1)));
  return { start, end: start + height - 1 };
}

function coversU(asset, u) {
  const o = assetOccupancy(asset);
  return u >= o.start && u <= o.end;
}

export function assetsOnFace(assets, rackId, face) {
  if (!rackId) return [];
  return (assets || []).filter(a => a && a.rackId === rackId && !isAssetArchived(a) && a.face === face);
}

export function assetAtRackU(assets, rackId, u, face) {
  return assetsOnFace(assets, rackId, face).find(a => coversU(a, u)) || null;
}

export function assetsAtRackU(assets, rackId, u) {
  if (!rackId) return [];
  return (assets || []).filter(a => a && a.rackId === rackId && !isAssetArchived(a) && coversU(a, u));
}

export function assetOwningPort(assets, portId) {
  if (!portId) return null;
  return (assets || []).find(a => Array.isArray(a?.ports) && a.ports.some(p => p && p.id === portId)) || null;
}

export function assetConflicts(assets, asset, ignoreId = null) {
  if (!asset?.rackId) return false;
  const a = assetOccupancy(asset);
  return (assets || []).some(x => {
    if (!x || x.id === ignoreId || x.rackId !== asset.rackId) return false;
    if (x.face !== asset.face || isAssetArchived(x)) return false;
    const b = assetOccupancy(x);
    return a.start <= b.end && b.start <= a.end;
  });
}

export function occupiedUnits(assets, rackId, face) {
  const used = new Set();
  assetsOnFace(assets, rackId, face).forEach(a => {
    const o = assetOccupancy(a);
    for (let u = o.start; u <= o.end; u++) used.add(u);
  });
  return used;
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test "js/test/*.test.mjs"`
Expected: PASS — 36 testes anteriores mais os 16 novos, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add js/occupancy.js js/test/occupancy.test.mjs
git commit -m "feat: adicionar módulo de ocupação de rack por face

Extrai ocupação e conflito para um módulo puro, testável sob Node, no
padrão de geometry.js e routing.js. Ainda não conectado ao app.js.

Corrige de propósito uma inconsistência existente: assetConflicts não
filtrava arquivados enquanto assetAtRackU filtrava, então uma U ocupada
só por asset arquivado aparecia livre no bayface mas recusava o save."
```

---

### Task 2: Conectar o app.js ao módulo

Troca a fundação sem mudar comportamento: nenhum asset tem `face` ainda, e `undefined === undefined` é verdadeiro, então a comparação de face é neutra nesta etapa.

**Files:**
- Modify: `app.js` — bloco de imports no topo; remover `assetOccupancy` (1712), `isAssetArchived` (1716), `assetConflicts` (1827), `assetAtRackU` (1832); atualizar os call sites.

**Interfaces:**
- Consumes: todos os exports da Task 1.
- Produces: `app.js` sem definições locais dessas quatro funções.

- [ ] **Step 1: Adicionar o import**

No bloco de imports do topo do `app.js`, depois do import de `./js/routing.js`, acrescentar:

```js
import {
  isAssetArchived, assetOccupancy, assetsOnFace, assetAtRackU,
  assetsAtRackU, assetOwningPort, assetConflicts, occupiedUnits
} from './js/occupancy.js';
```

- [ ] **Step 2: Remover as quatro definições locais**

Apagar do `app.js`, sem substituir por nada:
- `function assetOccupancy(asset){...}` (por volta da linha 1712, 3 linhas)
- `function isAssetArchived(asset){...}` (1 linha)
- `function assetConflicts(asset, ignoreId=null){...}` (por volta de 1827, 5 linhas)
- `function assetAtRackU(rackId,u){...}` (por volta de 1832, 4 linhas)

- [ ] **Step 3: Atualizar as chamadas que mudaram de assinatura**

`assetOccupancy` e `isAssetArchived` mantêm a assinatura — nenhuma chamada muda.

`assetConflicts` (1 call site, em `saveAssetForm`):

```js
// antes
if(assetConflicts(asset,id||null)){
// depois
if(assetConflicts(state.assets,asset,id||null)){
```

`assetAtRackU` (7 call sites). Nesta task todos passam `state.assets` e a face `'front'`, preservando o comportamento atual. A Task 5 substitui os cinco call sites de cabo por `assetsAtRackU`.

```js
// app.js:3193  (updateCableAssetNameField)
const asset=uInvalid?null:assetAtRackU(state.assets,rackId,u,'front');

// app.js:3218-3219  (renderCableProperties)
const originAsset=!ouInvalid?assetAtRackU(state.assets,c.originRack,Math.floor(num(c.originU,0)),'front'):null;
const destAsset=!duInvalid?assetAtRackU(state.assets,c.destRack,Math.floor(num(c.destU,0)),'front'):null;

// app.js:3511-3512  (processCableImportRows)
const originAsset=assetAtRackU(state.assets,origin.id,originU,'front');
const destAsset=assetAtRackU(state.assets,dest.id,destU,'front');

// app.js:3554  (cablePortAt)
function cablePortAt(rackId,u,portId){if(!portId)return null;return assetAtRackU(state.assets,rackId,u,'front')?.ports?.find(p=>p.id===portId)||null;}

// app.js:3557  (cableEndpointLabel)
const asset=assetAtRackU(state.assets,rackId,u,'front');
```

- [ ] **Step 4: Verificar sintaxe e testes**

```bash
node --test "js/test/*.test.mjs"
cp app.js "$(mktemp -d)/check.mjs" && node --check "$_"
```
Expected: testes `fail 0`; `node --check` sem saída (sintaxe válida).

- [ ] **Step 5: Verificar no browser que nada regrediu**

Servir a pasta e abrir no browser:

```bash
npx serve .
```

Entrar com **"Entrar como convidado (sem nuvem)"**. Criar uma fileira com um rack, abrir o bayface do rack, cadastrar um asset em uma U e confirmar: o asset aparece no bayface, tentar salvar outro asset na mesma U é recusado, e um cabo ligado a uma porta desse asset mostra o nome do asset no rótulo da ponta.

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "refactor: app.js passa a usar o módulo de ocupação

Remove as definições locais de assetOccupancy, isAssetArchived,
assetConflicts e assetAtRackU. Comportamento inalterado: nenhum asset tem
face ainda, e todos os call sites passam 'front' explicitamente."
```

---

### Task 3: Campo face no asset

Adiciona o campo ao modelo, migra os existentes e coloca o select na modal.

**Files:**
- Modify: `index.html:322` — grid que contém `assetRack` e `assetUStart`
- Modify: `app.js` — `normalizeAssets` (~2265), `updateAssetUFieldsState` (~2271), `openAssetModal` (~2399), `saveAssetForm` (~2458)

**Interfaces:**
- Consumes: `assetConflicts` da Task 1, já ciente de face.
- Produces: `asset.face` com `'front'`, `'rear'` ou `null`; elemento `#assetFace`.

- [ ] **Step 1: Adicionar o select no index.html**

Na linha 322, dentro do primeiro `div.grid2`, acrescentar um terceiro campo depois do `U inicial`:

```html
<label>Face <small class="field-help-inline">(obrigatória com rack)</small><select id="assetFace"><option value="">Selecione…</option><option value="front">Frente</option><option value="rear">Traseira</option></select></label>
```

- [ ] **Step 2: Migrar em normalizeAssets**

No literal de objeto de `normalizeAssets`, logo depois de `rackId:a.rackId||null,`, acrescentar:

```js
face:a.rackId?(a.face==='rear'?'rear':'front'):null,
```

Nota: `normalizeAssets` reconstrói cada asset campo a campo. Um campo ausente deste literal é descartado em toda chamada — por isso a linha é obrigatória, não opcional.

- [ ] **Step 3: Habilitar o campo só com rack**

Em `updateAssetUFieldsState`, depois do bloco que trata `heightEl`, acrescentar:

```js
  const faceEl=$('assetFace');
  if(faceEl){
    faceEl.disabled=!hasRack;
    faceEl.closest('label')?.classList.toggle('muted-field',!hasRack);
    if(!hasRack)faceEl.value='';
  }
```

- [ ] **Step 4: Preencher ao abrir a modal**

Em `openAssetModal`, logo depois da linha `$('assetStatus').value=...;$('assetSubstatus').value=...;`, acrescentar:

```js
  if($('assetFace'))$('assetFace').value=asset?.face||'';
```

- [ ] **Step 5: Validar e gravar no save**

Em `saveAssetForm`, depois da validação de `serial` e antes de `const rack=rackId?assetRack(rackId):null;`, acrescentar:

```js
  const face=rackId?($('assetFace')?.value||''):'';
  if(rackId && !face){toast('Face é obrigatória quando o asset está em um rack.');$('assetFace')?.focus();return;}
```

No literal que monta o objeto `asset`, depois de `rackId,`, acrescentar:

```js
face:rackId?face:null,
```

- [ ] **Step 6: Verificar no browser**

Com `npx serve .` e modo convidado: abrir a modal de asset sem rack e confirmar que o campo Face está cinza e desabilitado; escolher um rack e confirmar que ele habilita vazio; tentar salvar sem escolher face e confirmar o toast de erro; escolher Frente e salvar; reabrir o asset e confirmar que Frente aparece selecionada.

Depois, cadastrar um segundo asset no **mesmo rack e mesma U** com face Traseira e confirmar que **salva sem erro de conflito** — é a prova de que a ocupação virou por face.

- [ ] **Step 7: Commit**

```bash
git add index.html app.js
git commit -m "feat: campo de face no cadastro de asset

Face é obrigatória quando há rack e fica desabilitada sem rack, no mesmo
padrão do campo U inicial. Assets existentes migram para 'front' em
normalizeAssets. Com isso, dois assets podem ocupar a mesma U em faces
opostas."
```

---

### Task 4: Alternador FRONT/REAR no bayface

**Files:**
- Modify: `app.js` — `bayfaceMarkup` (~2892), `openBayface`/`renderBayface` (~2971/3012), `bind` (~5261)
- Modify: `app.css` — regras novas junto de `.bayface-asset`

**Interfaces:**
- Consumes: `assetsOnFace`, `occupiedUnits` da Task 1.
- Produces: variável de módulo `bayfaceFace`; elemento `#bayfaceFaceToggle`; classe CSS `.bayface-asset.is-ghost`.

- [ ] **Step 1: Declarar o estado da face**

Perto das outras variáveis de estado do bayface no `app.js`, acrescentar:

```js
let bayfaceFace='front';
```

- [ ] **Step 2: Filtrar os assets por face em bayfaceMarkup**

Em `bayfaceMarkup`, substituir a linha que monta `assets` e a que monta `occupiedUnits`:

```js
// antes
const assets=state.assets.filter(a=>a.rackId===rackId && !isAssetArchived(a)).sort((a,b)=>a.uStart-b.uStart||a.name.localeCompare(b.name));
const occupiedUnits=new Set();
assets.forEach(a=>{const o=assetOccupancy(a);for(let u=o.start;u<=o.end;u++)if(u>=1&&u<=units)occupiedUnits.add(u);});
const usedUnits=occupiedUnits.size;

// depois
const sortAssets=list=>list.slice().sort((a,b)=>a.uStart-b.uStart||a.name.localeCompare(b.name));
const assets=sortAssets(assetsOnFace(state.assets,rackId,bayfaceFace));
const ghostAssets=sortAssets(assetsOnFace(state.assets,rackId,bayfaceFace==='front'?'rear':'front'));
const occupied=occupiedUnits(state.assets,rackId,bayfaceFace);
const usedUnits=[...occupied].filter(u=>u>=1&&u<=units).length;
```

Em seguida, na montagem das linhas de U, trocar `occupiedUnits.has(u)` por `occupied.has(u)`.

- [ ] **Step 3: Extrair a montagem do chip e gerar a camada fantasma**

O `assets.map(...)` que monta `assetLayer` vira uma função reaproveitável. Substituir `const assetLayer=assets.map(a=>{` por:

```js
const chipFor=(a,ghost)=>{
```

e, no `return` desse bloco, trocar a linha do `<button ...>` por:

```js
    return `<button type="button" class="bayface-asset ${compact?'is-compact':''} ${ghost?'is-ghost':''}" style="top:${top};height:${h};--type-color:${esc(color)}" ${ghost?'tabindex="-1" aria-hidden="true"':`data-bay-edit="${esc(a.id)}"`} title="${ghost?esc(`${identity} · na outra face`):esc(tooltip)} · U${clampedStart}${span>1?`–U${end}`:''}">
```

Fechar a função e montar as duas camadas, substituindo o `}).join('');` final por:

```js
};
const assetLayer=ghostAssets.map(a=>chipFor(a,true)).join('')+assets.map(a=>chipFor(a,false)).join('');
```

Os fantasmas vêm primeiro para ficarem atrás dos chips reais na ordem de pintura.

- [ ] **Step 4: Trocar o rótulo estático pelo botão**

Substituir a linha do topbar:

```js
// antes
<div class="bayface-topbar"><span class="bayface-brand">${esc(r.name)}</span><span class="bayface-rack-state">FRONT</span></div>
// depois
<div class="bayface-topbar"><span class="bayface-brand">${esc(r.name)}</span><button type="button" class="bayface-rack-state" id="bayfaceFaceToggle" title="Alternar entre frente e traseira do rack">${bayfaceFace==='front'?'FRONT':'REAR'}</button></div>
```

- [ ] **Step 5: Ligar o clique**

`bayfaceMarkup` é reinjetado a cada render, então o handler precisa ser delegado. Em `bind()`, junto dos outros listeners do bayface, acrescentar:

```js
  document.addEventListener('click',e=>{
    if(!e.target.closest('#bayfaceFaceToggle'))return;
    bayfaceFace=bayfaceFace==='front'?'rear':'front';
    renderBayface();
  });
```

- [ ] **Step 6: Estilizar fantasma e botão**

Em `app.css`, depois da regra `.bayface-asset:hover`, acrescentar:

```css
.bayface-asset.is-ghost{opacity:.26;pointer-events:none;box-shadow:none;filter:saturate(.5)}
.bayface-asset.is-ghost .bayface-asset-u{opacity:.7}
button.bayface-rack-state{cursor:pointer;border:1px solid transparent;background:transparent;color:inherit;font:inherit;padding:0 4px;border-radius:3px}
button.bayface-rack-state:hover{border-color:color-mix(in srgb,var(--blue) 45%,transparent);background:color-mix(in srgb,var(--blue) 14%,transparent)}
```

- [ ] **Step 7: Verificar no browser**

Com dois assets no mesmo rack, um em cada face na mesma U: abrir o bayface, confirmar que o topbar mostra `FRONT` e só o asset frontal está sólido, com o traseiro esmaecido e não clicável. Clicar no `FRONT`, confirmar que vira `REAR`, que os papéis se invertem, e que os contadores `U ocupadas`/`U livres` mudam junto. Confirmar que uma U livre na face visível continua clicável para adicionar.

- [ ] **Step 8: Commit**

```bash
git add app.js app.css
git commit -m "feat: alternador frente/traseira no bayface

O rótulo FRONT do topbar vira botão que alterna a face visível. Assets da
face oposta aparecem como camada fantasma, sem clique, só como referência
do que existe do outro lado. Contadores passam a ser da face visível."
```

---

### Task 5: Cabos alcançam portas das duas faces

**Files:**
- Modify: `app.js:3193`, `app.js:3218-3219`, `app.js:3511-3512`, `app.js:3554`, `app.js:3557`

**Interfaces:**
- Consumes: `assetsAtRackU`, `assetOwningPort` da Task 1.
- Produces: resolução de ponta de cabo independente de face.

- [ ] **Step 1: cablePortAt procura nas duas faces**

```js
// antes
function cablePortAt(rackId,u,portId){if(!portId)return null;return assetAtRackU(state.assets,rackId,u,'front')?.ports?.find(p=>p.id===portId)||null;}
// depois
function cablePortAt(rackId,u,portId){
  if(!portId)return null;
  for(const a of assetsAtRackU(state.assets,rackId,u)){
    const p=a.ports?.find(p=>p.id===portId);
    if(p)return p;
  }
  return null;
}
```

- [ ] **Step 2: cableEndpointLabel nomeia pelo dono da porta**

```js
// antes
const asset=assetAtRackU(state.assets,rackId,u,'front');
// depois
const atU=assetsAtRackU(state.assets,rackId,u);
const asset=assetOwningPort(state.assets,portId)||(atU.length===1?atU[0]:null);
```

Sem porta escolhida e com as duas faces ocupadas, `asset` fica `null` e o rótulo cai no `assetNameFallback` que a função já recebe.

- [ ] **Step 3: updateCableAssetNameField trava só quando a U é inequívoca**

```js
// antes
const asset=uInvalid?null:assetAtRackU(state.assets,rackId,u,'front');
// depois
const portId=side==='origin'?c.originPortId:c.destPortId;
const atU=uInvalid?[]:assetsAtRackU(state.assets,rackId,u);
const asset=assetOwningPort(state.assets,portId)||(atU.length===1?atU[0]:null);
```

- [ ] **Step 4: renderCableProperties resolve as duas pontas do mesmo jeito**

```js
// antes
const originAsset=!ouInvalid?assetAtRackU(state.assets,c.originRack,Math.floor(num(c.originU,0)),'front'):null;
const destAsset=!duInvalid?assetAtRackU(state.assets,c.destRack,Math.floor(num(c.destU,0)),'front'):null;
// depois
const originAtU=ouInvalid?[]:assetsAtRackU(state.assets,c.originRack,Math.floor(num(c.originU,0)));
const destAtU=duInvalid?[]:assetsAtRackU(state.assets,c.destRack,Math.floor(num(c.destU,0)));
const originAsset=assetOwningPort(state.assets,c.originPortId)||(originAtU.length===1?originAtU[0]:null);
const destAsset=assetOwningPort(state.assets,c.destPortId)||(destAtU.length===1?destAtU[0]:null);
```

- [ ] **Step 5: A importação de cabos casa o rótulo nas duas faces**

Em `processCableImportRows`, substituir o par de linhas que resolve os assets (app.js:3511-3512):

```js
// antes
const originAsset=assetAtRackU(state.assets,origin.id,originU,'front');
const destAsset=assetAtRackU(state.assets,dest.id,destU,'front');
// depois
const originAssets=assetsAtRackU(state.assets,origin.id,originU);
const destAssets=assetsAtRackU(state.assets,dest.id,destU);
const findPortByLabel=(list,label)=>{
  for(const a of list){
    const port=(a.ports||[]).find(p=>p.label===label);
    if(port)return {asset:a,port};
  }
  return null;
};
```

Substituir o bloco que casa os rótulos de porta (app.js:3513-3522):

```js
// antes
let originPortId=null, destPortId=null, originPortLabelFree='', destPortLabelFree='';
const originPortLabel=String(val(row,'Porta Origem','')).trim();
const destPortLabel=String(val(row,'Porta Destino','')).trim();
if(originPortLabel){
  if(originAsset?.ports?.length){const port=originAsset.ports.find(p=>p.label===originPortLabel);if(port)originPortId=port.id;else portsUnmatched++;}
  else originPortLabelFree=originPortLabel; // sem portas cadastradas no modelo: aceita o texto livre sem validar
}
if(destPortLabel){
  if(destAsset?.ports?.length){const port=destAsset.ports.find(p=>p.label===destPortLabel);if(port)destPortId=port.id;else destPortLabelFree=destPortLabel;}
  else destPortLabelFree=destPortLabel;
}
// depois
let originPortId=null, destPortId=null, originPortLabelFree='', destPortLabelFree='';
const originPortLabel=String(val(row,'Porta Origem','')).trim();
const destPortLabel=String(val(row,'Porta Destino','')).trim();
const originHit=originPortLabel?findPortByLabel(originAssets,originPortLabel):null;
const destHit=destPortLabel?findPortByLabel(destAssets,destPortLabel):null;
if(originPortLabel){
  if(originHit)originPortId=originHit.port.id;
  else if(originAssets.some(a=>a.ports?.length))portsUnmatched++;
  else originPortLabelFree=originPortLabel; // sem portas cadastradas no modelo: aceita o texto livre sem validar
}
if(destPortLabel){
  if(destHit)destPortId=destHit.port.id;
  else if(destAssets.some(a=>a.ports?.length))portsUnmatched++;
  else destPortLabelFree=destPortLabel;
}
```

Atenção: o código original tem um deslize no ramo de destino — ele escreve `destPortLabelFree=destPortLabel` onde o de origem faz `portsUnmatched++`. A versão acima corrige, deixando as duas pontas simétricas.

Substituir as duas linhas que derivam o nome do asset (app.js:3526-3527):

```js
// antes
const originAssetName=originAsset?originAsset.name:String(val(row,'Nome Asset Origem','')).trim();
const destAssetName=destAsset?destAsset.name:String(val(row,'Nome Asset Destino','')).trim();
// depois
const originAsset=originHit?.asset||(originAssets.length===1?originAssets[0]:null);
const destAsset=destHit?.asset||(destAssets.length===1?destAssets[0]:null);
const originAssetName=originAsset?originAsset.name:String(val(row,'Nome Asset Origem','')).trim();
const destAssetName=destAsset?destAsset.name:String(val(row,'Nome Asset Destino','')).trim();
```

- [ ] **Step 6: Remover o import que ficou morto**

Depois desta task nenhuma linha do `app.js` usa mais `assetAtRackU` — o bayface usa `assetsOnFace` e os cabos usam `assetsAtRackU`. Remover `assetAtRackU,` do bloco de import adicionado na Task 2.

Confirmar com: `grep -c "assetAtRackU" app.js` — esperado `0`.

- [ ] **Step 7: Verificar no browser**

Montar o cenário decisivo: um switch na frente da U40 com uma porta `eth0`, e um PDU atrás da U40 com uma porta `C13-1`. Criar um cabo com ponta nessa U e confirmar que o seletor de porta oferece **as duas** portas. Escolher `C13-1`, salvar, e confirmar que o rótulo da ponta mostra o nome do **PDU**, não o do switch. Reabrir o cabo e confirmar que a porta continua resolvida.

- [ ] **Step 8: Commit**

```bash
git add app.js
git commit -m "fix: ponta de cabo resolve portas das duas faces da U

Com ocupação por face, (rack, U) deixou de identificar um único asset. O
alvo de uma ponta sempre foi o ID da porta, que é único — então a
resolução passa a procurar nas duas faces e a nomear a ponta pelo asset
dono da porta escolhida, sem adicionar campo de face ao cabo."
```

---

### Task 6: Coluna Face no cadastro em lote

**Files:**
- Modify: `index.html` — `<colgroup>` e `<thead>` da tabela `.bulk-assets-table`
- Modify: `app.js` — `bulkOccupiedSet` (~5113), `bulkAvailableStarts` (~5119), `refreshBulkRow` (~5122), `bulkRowHtml` (~5150), `initBulkTableResizers` (~5169), `saveBulkAssets` (~5213)

**Interfaces:**
- Consumes: `assetsOnFace`, `assetOccupancy` da Task 1.
- Produces: campo `data-bulk-field="face"` em cada linha.

- [ ] **Step 1: Coluna no HTML**

Na tabela do lote em `index.html`, acrescentar `<col data-col="face">` imediatamente antes do `<col data-col="u">`, e o cabeçalho `<th>Face</th>` imediatamente antes do `<th>` da coluna U.

- [ ] **Step 2: Célula na linha**

Em `bulkRowHtml`, inserir antes da célula da coluna `u`:

```js
<td><select class="bulk-face" data-bulk-field="face"><option value="">Selecione</option><option value="front">Frente</option><option value="rear">Traseira</option></select></td>
```

- [ ] **Step 3: Larguras da coluna**

Em `initBulkTableResizers`, acrescentar `face:5` ao objeto `defaults` e `face:74` ao objeto `mins`, ambos entre as entradas `rack` e `u`.

- [ ] **Step 4: Ocupação do lote passa a considerar a face**

```js
// antes
function bulkOccupiedSet(rackId,ignoreRow=null){
  const used=new Set();
  state.assets.filter(a=>a.rackId===rackId&&!isAssetArchived(a)).forEach(a=>{const o=assetOccupancy(a);for(let u=o.start;u<=o.end;u++)used.add(u);});
  document.querySelectorAll('#assetsBulkBody tr').forEach(row=>{if(row===ignoreRow)return;const rid=row.querySelector('[data-bulk-field="rack"]')?.value||'';if(rid!==rackId)return;const start=Number(row.querySelector('[data-bulk-field="u"]')?.value||0),height=Math.max(1,Number(row.querySelector('[data-bulk-field="height"]')?.value||1));if(start>0)for(let u=start;u<start+height;u++)used.add(u);});
  return used;
}
// depois
function bulkOccupiedSet(rackId,face,ignoreRow=null){
  const used=occupiedUnits(state.assets,rackId,face);
  document.querySelectorAll('#assetsBulkBody tr').forEach(row=>{if(row===ignoreRow)return;const rid=row.querySelector('[data-bulk-field="rack"]')?.value||'';if(rid!==rackId)return;const rface=row.querySelector('[data-bulk-field="face"]')?.value||'';if(rface!==face)return;const start=Number(row.querySelector('[data-bulk-field="u"]')?.value||0),height=Math.max(1,Number(row.querySelector('[data-bulk-field="height"]')?.value||1));if(start>0)for(let u=start;u<start+height;u++)used.add(u);});
  return used;
}
```

- [ ] **Step 5: Repassar a face no cálculo das U livres**

```js
// antes
function bulkAvailableStarts(rackId,height=1,ignoreRow=null){
  const rack=assetRack(rackId);if(!rack)return[];const units=...;const used=bulkOccupiedSet(rackId,ignoreRow);
// depois
function bulkAvailableStarts(rackId,face,height=1,ignoreRow=null){
  const rack=assetRack(rackId);if(!rack||!face)return[];const units=...;const used=bulkOccupiedSet(rackId,face,ignoreRow);
```

O resto do corpo fica igual. Sem face escolhida a lista vem vazia, que é o que trava a coluna U.

- [ ] **Step 6: A linha passa a depender de rack e face**

Em `refreshBulkRow`, depois do bloco que trata `rackEl` e antes de calcular `starts`:

```js
  const faceEl=row.querySelector('[data-bulk-field="face"]');
  const hasRackForFace=!!rackEl?.value;
  if(faceEl){
    faceEl.disabled=!hasRackForFace;
    faceEl.closest('td')?.classList.toggle('muted-field',!hasRackForFace);
    if(!hasRackForFace)faceEl.value='';
  }
  const face=faceEl?.value||'';
```

Trocar a chamada de `starts` e a condição de habilitação da coluna U:

```js
// antes
const starts=bulkAvailableStarts(rack,height,row);
...
const hasRack=!!rack;
uEl.disabled=!hasRack;
uEl.closest('td')?.classList.toggle('muted-field',!hasRack);
// depois
const starts=bulkAvailableStarts(rack,face,height,row);
...
const ready=!!rack&&!!face;
uEl.disabled=!ready;
uEl.closest('td')?.classList.toggle('muted-field',!ready);
```

- [ ] **Step 7: Recalcular quando a face muda**

Os listeners do lote são ligados por linha em `addBulkRow` (app.js:5217-5219). Junto do listener de `rack`, acrescentar o de `face`:

```js
// linha existente, app.js:5219
rack.addEventListener('change',()=>refreshAllBulkRows());
// acrescentar logo abaixo
row.querySelector('[data-bulk-field="face"]')?.addEventListener('change',()=>refreshAllBulkRows());
```

`refreshAllBulkRows` é o certo aqui, e não `refreshBulkRow`: mudar a face de uma linha muda quais U as **outras** linhas do mesmo rack podem oferecer.

- [ ] **Step 8: Gravar e validar no save**

Em `saveBulkAssets`, ao montar cada asset, ler `g('face')` e gravar `face:rackId?(g('face')||null):null`. Antes de gravar, rejeitar linha com rack e sem face:

```js
if(rackId && !g('face')){toast(`Linha ${i+1}: escolha a face do rack.`);return;}
```

- [ ] **Step 9: Verificar no browser**

Abrir o cadastro em lote: confirmar que Face começa desabilitada, habilita ao escolher rack, e que a coluna U só habilita depois da face escolhida. Em duas linhas do mesmo rack, escolher a **mesma U** com faces diferentes e confirmar que ambas oferecem aquela U e que o lote salva. Depois, duas linhas mesma U e mesma face: a segunda não deve oferecer a U já tomada pela primeira.

- [ ] **Step 10: Commit**

```bash
git add index.html app.js
git commit -m "feat: coluna Face no cadastro de assets em lote

A cadeia da linha vira localização > rack > face > U, porque as U livres
agora dependem da face. Duas linhas no mesmo rack em faces opostas deixam
de bloquear uma à outra."
```

---

### Task 7: Coluna Face na importação XLSX

**Files:**
- Modify: `app.js` — `assetImportUOptions` (~4506), `validateAssetImportRows` (~4532)

**Interfaces:**
- Consumes: `occupiedUnits`, `assetOccupancy` da Task 1.
- Produces: coluna `Face` reconhecida na planilha de assets.

- [ ] **Step 1: Normalizar o valor da planilha**

Perto das outras funções auxiliares de importação no `app.js`, acrescentar:

```js
function parseImportFace(raw){
  const v=catalogNormalize(String(raw||''));
  if(v==='traseira'||v==='tras'||v==='rear'||v==='back')return 'rear';
  return 'front';
}
```

Ausente ou irreconhecível cai em `front` de propósito: planilha antiga não tem a coluna e falharia inteira sem esse default.

- [ ] **Step 2: Chavear a ocupação por rack e face na validação**

A regra é uniforme nos dois caminhos de importação: **toda chave que hoje é `rack.id` passa a ser `` `${rack.id}|${face}` ``**. São dois mapas por caminho — o de assets já salvos (`occupiedByRack`) e o de U reservadas por outras linhas da mesma importação (`plannedByRack`). Se só o primeiro mudar, duas linhas da planilha em faces opostas seguem se bloqueando.

Em `validateAssetImportRows`:

```js
// app.js:4536-4541, antes
const occupiedByRack=new Map();
(state.assets||[]).filter(a=>a.rackId&&!isAssetArchived(a)).forEach(a=>{
  const set=occupiedByRack.get(a.rackId)||new Set(), o=assetOccupancy(a);
  for(let u=o.start;u<=o.end;u++) set.add(u);
  occupiedByRack.set(a.rackId,set);
});
// depois
const occupiedByRack=new Map();
(state.assets||[]).filter(a=>a.rackId&&!isAssetArchived(a)).forEach(a=>{
  const key=`${a.rackId}|${a.face||'front'}`;
  const set=occupiedByRack.get(key)||new Set(), o=assetOccupancy(a);
  for(let u=o.start;u<=o.end;u++) set.add(u);
  occupiedByRack.set(key,set);
});
```

```js
// app.js:4606-4607, antes
const existing=occupiedByRack.get(rack.id)||new Set();
const planned=plannedByRack.get(rack.id)||new Map();
// depois
const faceKey=`${rack.id}|${parseImportFace(d.Face)}`;
const existing=occupiedByRack.get(faceKey)||new Set();
const planned=plannedByRack.get(faceKey)||new Map();
```

O `d` está em escopo aqui: este bloco roda dentro do `rows.forEach((item,idx)=>{` que começa em app.js:4563 e declara `const d=item.data||{}` no topo.

```js
// app.js:4624, antes
plannedByRack.set(rack.id,planned);
// depois
plannedByRack.set(faceKey,planned);
```

- [ ] **Step 3: Mesma troca em processAssetsWorkbook**

`processAssetsWorkbook` (app.js:4947) tem o seu próprio par de mapas, com a mesma estrutura:

```js
// app.js:4964-4965, antes
const set=occupiedByRack.get(a.rackId)||new Set(),o=assetOccupancy(a);
for(let u=o.start;u<=o.end;u++)set.add(u); occupiedByRack.set(a.rackId,set);
// depois
const key=`${a.rackId}|${a.face||'front'}`;
const set=occupiedByRack.get(key)||new Set(),o=assetOccupancy(a);
for(let u=o.start;u<=o.end;u++)set.add(u); occupiedByRack.set(key,set);
```

```js
// app.js:5008-5009, antes
const used=new Set(occupiedByRack.get(rack.id)||[]);
const planned=plannedByRack.get(rack.id)||new Set();
// depois
const faceKey=`${rack.id}|${parseImportFace(d.Face)}`;
const used=new Set(occupiedByRack.get(faceKey)||[]);
const planned=plannedByRack.get(faceKey)||new Set();
```

```js
// app.js:5013, antes
if(valid){for(let u=uStart;u<uStart+uHeight;u++)planned.add(u);plannedByRack.set(rack.id,planned);}
// depois
if(valid){for(let u=uStart;u<uStart+uHeight;u++)planned.add(u);plannedByRack.set(faceKey,planned);}
```

Ainda neste caminho, a detecção de duplicata por posição (app.js:5022) compara rack e U e precisa comparar face também:

```js
// antes
const exactLocation=(state.assets||[]).find(a=>!isAssetArchived(a)&&a.rackId===rack.id&&uStart<=assetOccupancy(a).end&&assetOccupancy(a).start<=uStart+uHeight-1);
// depois
const rowFace=parseImportFace(d.Face);
const exactLocation=(state.assets||[]).find(a=>!isAssetArchived(a)&&a.rackId===rack.id&&(a.face||'front')===rowFace&&uStart<=assetOccupancy(a).end&&assetOccupancy(a).start<=uStart+uHeight-1);
```

Atenção: `processAssetsWorkbook` só monta o **preview** (`preview.push({valid,line,data:d,...})`). O asset de verdade é criado no handler de confirmação da importação, em **app.js:5049**, num literal grande passado para `autoFillAssetFromModel`. É lá que a face é gravada — logo depois de `rackId:rack?.id||null,`:

```js
face:rack?parseImportFace(d.Face):null,
```

O `d` desse ponto é `item.data`, já declarado na mesma linha, então `parseImportFace(d.Face)` funciona sem nenhuma outra mudança.

- [ ] **Step 4: O seletor de U do preview respeita a face**

Em `assetImportUOptions` (app.js:4515), trocar as duas varreduras que montam `used`:

```js
// app.js:4520-4523, antes
const used=new Set();
(state.assets||[]).filter(a=>a.rackId===rackId&&!isAssetArchived(a)).forEach(a=>{const o=assetOccupancy(a);for(let u=o.start;u<=o.end;u++)used.add(u);});
const rows=pendingImport?.rows||[];
rows.forEach(other=>{if(other===item||!other.valid)return;const rr=(state.rooms||[]).find(r=>catalogNormalize(r.name)===catalogNormalize(other.data?.Sala));const rk=rr?.data?.racks?.find(r=>catalogNormalize(r.name)===catalogNormalize(other.data?.Rack));if(rk?.id===rackId){const st=Math.floor(parseImportNumber(other.data?.['U Inicial'],0)),h=Math.max(1,Math.floor(parseImportNumber(other.data?.['Quantidade U'],1)));if(st)for(let u=st;u<st+h;u++)used.add(u);}});
// depois
const face=parseImportFace(item.data?.Face);
const used=occupiedUnits(state.assets,rackId,face);
const rows=pendingImport?.rows||[];
rows.forEach(other=>{if(other===item||!other.valid)return;if(parseImportFace(other.data?.Face)!==face)return;const rr=(state.rooms||[]).find(r=>catalogNormalize(r.name)===catalogNormalize(other.data?.Sala));const rk=rr?.data?.racks?.find(r=>catalogNormalize(r.name)===catalogNormalize(other.data?.Rack));if(rk?.id===rackId){const st=Math.floor(parseImportNumber(other.data?.['U Inicial'],0)),h=Math.max(1,Math.floor(parseImportNumber(other.data?.['Quantidade U'],1)));if(st)for(let u=st;u<st+h;u++)used.add(u);}});
```

`occupiedUnits` devolve um `Set` novo a cada chamada, então mutá-lo com `used.add(u)` logo abaixo é seguro.

- [ ] **Step 5: Verificar no browser**

Importar uma planilha **sem** a coluna `Face` e confirmar que tudo entra como Frente, sem erro. Depois, importar uma planilha com a coluna preenchida com `Traseira` numa U já ocupada na frente e confirmar que a linha é aceita, não acusada como conflito. Por fim, uma planilha com duas linhas no mesmo rack e mesma U, uma `Frente` e outra `Traseira`: ambas devem ser aceitas — é o caso que prova que `plannedByRack` também foi chaveado por face.

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "feat: coluna Face na importação de assets

Coluna opcional aceitando Frente/Traseira. Ausente ou vazia assume
Frente, para não quebrar planilha antiga. A validação de U ocupada passa
a ser por rack e face."
```

---

## Verificação final

- [ ] `node --test "js/test/*.test.mjs"` — todos passando
- [ ] Cenário completo no browser, em modo convidado: rack com switch na frente da U40 e PDU atrás da U40; bayface alterna entre as duas faces mostrando a oposta esmaecida; cabo ligado à porta do PDU traseiro resolve o nome correto; lote e importação aceitam a mesma U em faces opostas
- [ ] `git log --oneline` mostra sete commits, um por task
