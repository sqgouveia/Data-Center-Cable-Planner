# Cabo MTP Breakout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar um cabo MTP breakout como um cabo só (N pernas), escolher o produto do fornecedor (total + perna) pela rota real, detectar breakouts sozinho na importação e contar 1 item por breakout no resumo.

**Architecture:** Lógica pura num módulo novo `js/breakout-model.js` (perna pela letra da porta, metragens, escolha do produto, agrupamento da importação, perna como "cabo virtual") e `calcBreakout` em `js/routing.js`, tudo testado em Node. A tela fica em `js/breakouts.js` (lista, painel, catálogo, export), no padrão `configureX`. O resto do app enxerga cada perna como um cabo virtual (`breakoutLegCable`), então ocupação de porta e desenho de rota reaproveitam o código atual.

**Tech Stack:** JS puro (ES modules, sem build), `node:test`, ExcelJS/SheetJS já carregados.

**Spec:** `docs/superpowers/specs/2026-09-24-mtp-breakout-design.md`

## Global Constraints

- Sem build, sem dependência nova. Módulo novo em `js/` exige `node scripts/bump-version.mjs css` (import map + `js/test/versions.test.mjs`).
- Textos de tela em pt-BR, no tom do app.
- Nunca reatribuir `state`; só mutar propriedades.
- Módulo extraído recebe o que precisa do `app.js` por `configureBreakouts({...})`.
- Detecção: tipo contém "breakout" ou "MTP" (via `catalogNormalize`) **e** porta termina em número + letra A–H.
- Metragem de breakout = produto do usuário `{ m: total, leg, price? }`; escolha = menor total, empate menor perna, com `leg ≥ perna necessária` e `m − leg ≥ tronco necessário`.
- Resumo: 1 item por breakout, agrupado por tipo + total + perna.
- Rodar `node --test "js/test/*.test.mjs"` ao fim de cada tarefa; tudo verde antes do commit.

## Refinamento do spec (decidido no plano)

- Pernas guardam os campos no formato do cabo (`destRack`, `destU`, `destFace`, `destPortId`, `destPortLabel`, `destAssetName`, mais `lane`, `originPortId`, `originPortLabel`), e a origem é `{ rack, u, face, assetName }`. Assim `breakoutLegCable` vira um cabo comum sem tradução.
- Ponto de divisão calculado pela distância entre destinos (não por nó comum do grafo): em árvore, tronco = menor `(T_i + T_j − D_ij)/2`. Os ids de nó de acesso mudam por destino, então prefixo comum erraria para destinos na mesma calha.
- As funções puras ficam em `js/breakout-model.js` em vez de `js/utils.js` (utils já é grande e isso é um assunto só).

## Review Focus

1. Trocar de sala: `applyRoomData` só copia chaves presentes — sala antiga sem `breakouts` herdaria os breakouts da sala anterior. Esperado: sala sem a chave fica com `[]`. (Task 4)
2. Mesma perna duas vezes na planilha (duas linhas `1A`): esperado virar um breakout com uma perna e a segunda linha ficar cabo comum, sem perder dado. (Task 1)
3. Breakout com perna para o mesmo rack da origem e outra perna remota: divisão na porta, tronco ≈ só conexão, perna remota = rota inteira. (Task 2)
4. Porta de breakout já usada por um cabo comum (ou por outro breakout): esperado aparecer o aviso de porta em uso, como no cabo comum. (Task 5)
5. Apagar o rack de origem de um breakout: esperado sumir o breakout; apagar rack de destino: perna fica sem destino e o cálculo ignora essa perna. (Task 5)

---

### Task 1: Modelo puro do breakout

**Files:**
- Create: `js/breakout-model.js`
- Test: `js/test/breakout-model.test.mjs`
- Modify: `index.html` (import map, via script)

**Interfaces:**
- Produces:
  - `breakoutLane(label) → { base: string, lane: 'A'..'H' } | null`
  - `isBreakoutTypeName(name, breakoutTypes=[]) → boolean`
  - `normalizeBreakoutLengths(list) → [{ m, leg, price? }]` (ordenado por m, depois leg)
  - `pickBreakoutLength(trunkNeeded, legNeeded, lengths) → { pick: { m, leg, price|null } | null, reason: null|'empty'|'leg'|'total' }`
  - `breakoutLegCable(b, leg) → cable-like object` (id `${b.id}:${leg.lane}`, `breakoutId`)
  - `groupBreakoutCables(cables, portLabel, isBreakoutType) → { cables, breakouts }` (breakouts sem `id`, com `{ name, type, slack, origin, base, legs }`)
  - `resolveBreakoutType(typeName, maxLane, breakoutTypes) → { name, created: object|null }`

- [ ] **Step 1: Write the failing test** — `js/test/breakout-model.test.mjs`

```js
// Modelo do breakout: perna pela letra da porta, produto do fornecedor e agrupamento da importação.
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  breakoutLane, isBreakoutTypeName, normalizeBreakoutLengths, pickBreakoutLength,
  breakoutLegCable, groupBreakoutCables, resolveBreakoutType,
} from '../breakout-model.js';

test('letra final da porta é a perna', () => {
  assert.deepEqual(breakoutLane('1A'), { base: '1', lane: 'A' });
  assert.deepEqual(breakoutLane('12d'), { base: '12', lane: 'D' });
  assert.deepEqual(breakoutLane('Gi1/0/1A'), { base: 'Gi1/0/1', lane: 'A' });
  assert.equal(breakoutLane('Gi1/0/1'), null);
  assert.equal(breakoutLane('1J'), null);
  assert.equal(breakoutLane('A'), null);
});

test('tipo breakout: contém breakout ou MTP, ou é tipo do catálogo', () => {
  assert.equal(isBreakoutTypeName('MTP OM4'), true);
  assert.equal(isBreakoutTypeName('Breakout 1x4'), true);
  assert.equal(isBreakoutTypeName('Fibra Multi Mode'), false);
  assert.equal(isBreakoutTypeName('Harness X', [{ name: 'Harness X' }]), true);
});

test('metragens: ordena, tira repetido, descarta perna >= total', () => {
  assert.deepEqual(
    normalizeBreakoutLengths([{ m: 10, leg: 2, price: '260' }, { m: 5, leg: 1 }, { m: 10, leg: 1 }, { m: 3, leg: 3 }, { m: 10, leg: 1, price: 9 }]),
    [{ m: 5, leg: 1 }, { m: 10, leg: 1, price: 9 }, { m: 10, leg: 2, price: 260 }],
  );
});

test('escolhe o menor total que atende tronco e perna; empate, menor perna', () => {
  const list = normalizeBreakoutLengths([{ m: 5, leg: 1, price: 180 }, { m: 10, leg: 1 }, { m: 10, leg: 2, price: 260 }]);
  assert.deepEqual(pickBreakoutLength(8.4, 0.7, list), { pick: { m: 10, leg: 1, price: null }, reason: null });
  assert.deepEqual(pickBreakoutLength(3, 1.5, list), { pick: { m: 10, leg: 2, price: 260 }, reason: null });
  assert.deepEqual(pickBreakoutLength(1, 3, list), { pick: null, reason: 'leg' });
  assert.deepEqual(pickBreakoutLength(20, 1, list), { pick: null, reason: 'total' });
  assert.deepEqual(pickBreakoutLength(1, 1, []), { pick: null, reason: 'empty' });
});

const cable = (name, type, oPort, dRack, dPort, extra = {}) => ({
  id: name, name, type, slack: 10, originRack: 'r0', originU: 40, originFace: 'front',
  originPortId: 'p' + oPort, originPortLabel: '', originAssetName: 'SW1',
  destRack: dRack, destU: 10, destFace: 'front', destPortId: 'p' + dPort, destPortLabel: '', destAssetName: 'SRV', ...extra,
});
const labelOf = (c, side) => (side === 'origin' ? c.originPortId : c.destPortId).slice(1);
const isBo = n => isBreakoutTypeName(n);

test('agrupa 1A-1D, 2A-2C e 3A-3B em três breakouts; o resto fica cabo comum', () => {
  const rows = [
    cable('c1', 'MTP OM4', '1A', 'r1', 'x'), cable('c2', 'MTP OM4', '1B', 'r2', 'x'),
    cable('c3', 'MTP OM4', '1C', 'r1', 'y'), cable('c4', 'MTP OM4', '1D', 'r3', 'x'),
    cable('c5', 'MTP OM4', '2A', 'r1', 'z'), cable('c6', 'MTP OM4', '2B', 'r1', 'w'), cable('c7', 'MTP OM4', '2C', 'r2', 'z'),
    cable('c8', 'MTP OM4', '3B', 'r1', 'k'), cable('c9', 'MTP OM4', '3A', 'r1', 'j'),
    cable('c10', 'Fibra Multi Mode', '4A', 'r1', 'q'),   // tipo comum: continua cabo
    cable('c11', 'MTP OM4', '5', 'r1', 'q'),             // porta sem letra: continua cabo
  ];
  const { cables, breakouts } = groupBreakoutCables(rows, labelOf, isBo);
  assert.deepEqual(cables.map(c => c.id), ['c10', 'c11']);
  assert.deepEqual(breakouts.map(b => [b.base, b.legs.map(l => l.lane).join('')]), [['1', 'ABCD'], ['2', 'ABC'], ['3', 'AB']]);
  assert.equal(breakouts[0].name, 'c1');
  assert.deepEqual(breakouts[0].origin, { rack: 'r0', u: 40, face: 'front', assetName: 'SW1' });
  assert.equal(breakouts[0].legs[1].destRack, 'r2');
});

test('porta com letra no destino inverte a linha', () => {
  const row = cable('c1', 'MTP OM4', 'x', 'r5', '7B');
  const { breakouts } = groupBreakoutCables([row], labelOf, isBo);
  assert.equal(breakouts[0].origin.rack, 'r5');
  assert.equal(breakouts[0].legs[0].lane, 'B');
  assert.equal(breakouts[0].legs[0].destRack, 'r0');
  assert.equal(breakouts[0].legs[0].originPortId, 'p7B');
});

test('mesma perna duas vezes: a segunda linha fica cabo comum', () => {
  const { cables, breakouts } = groupBreakoutCables(
    [cable('c1', 'MTP OM4', '1A', 'r1', 'x'), cable('c2', 'MTP OM4', '1A', 'r2', 'y')], labelOf, isBo);
  assert.equal(breakouts[0].legs.length, 1);
  assert.deepEqual(cables.map(c => c.id), ['c2']);
});

test('perna vira cabo virtual com id do breakout', () => {
  const b = { id: 'bo1', name: 'BO', type: 'MTP OM4', slack: 5, origin: { rack: 'r0', u: 40, face: 'front', assetName: 'SW1' },
    legs: [{ lane: 'A', originPortId: 'p1A', originPortLabel: '', destRack: 'r1', destU: 10, destFace: 'rear', destPortId: 'd1', destPortLabel: '', destAssetName: 'SRV' }] };
  const c = breakoutLegCable(b, b.legs[0]);
  assert.equal(c.id, 'bo1:A');
  assert.equal(c.breakoutId, 'bo1');
  assert.equal(c.originPortId, 'p1A');
  assert.equal(c.destFace, 'rear');
  assert.equal(c.routeMode, 'automatic');
});

test('tipo do breakout: usa o existente ou cria um 1xN', () => {
  const types = [{ name: 'MTP OM4 — breakout 1×4', legs: 4 }];
  assert.deepEqual(resolveBreakoutType('MTP OM4 — breakout 1×4', 'D', types), { name: 'MTP OM4 — breakout 1×4', created: null });
  assert.deepEqual(resolveBreakoutType('MTP OM4', 'C', types), { name: 'MTP OM4 — breakout 1×4', created: null });
  const r = resolveBreakoutType('MTP OM3', 'F', types);
  assert.equal(r.name, 'MTP OM3 — breakout 1×6');
  assert.deepEqual(r.created, { name: 'MTP OM3 — breakout 1×6', color: '#2dd4bf', legs: 6, lengths: [] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test js/test/breakout-model.test.mjs`
Expected: FAIL, `Cannot find module ... breakout-model.js`

- [ ] **Step 3: Write the implementation** — `js/breakout-model.js`

```js
// Modelo do cabo MTP breakout, sem DOM: perna pela letra da porta (1A…1H), produtos do
// fornecedor (total + perna), escolha do produto, perna como cabo virtual e o agrupamento
// das linhas importadas. Testado em js/test/breakout-model.test.mjs.
import { catalogNormalize, parseImportNumber } from './utils.js';

const LANES = 'ABCDEFGH';

export function breakoutLane(label){
  const m=/^(.*\d)([A-H])$/i.exec(String(label??'').trim());
  return m?{base:m[1],lane:m[2].toUpperCase()}:null;
}
export function isBreakoutTypeName(name,breakoutTypes=[]){
  const n=catalogNormalize(name);
  return n.includes('breakout')||n.includes('mtp')||breakoutTypes.some(t=>catalogNormalize(t.name)===n);
}
// Produtos do fornecedor: { m: total, leg: perna, price? }. Só m>0, leg>0 e leg<m; um por
// (total, perna); ordenados por total e depois perna — pickBreakoutLength depende dessa ordem.
export function normalizeBreakoutLengths(list){
  const byKey=new Map();
  (Array.isArray(list)?list:[]).forEach(x=>{
    const m=Math.round(parseImportNumber(x?.m,0)*100)/100, leg=Math.round(parseImportNumber(x?.leg,0)*100)/100;
    if(!(m>0&&leg>0&&leg<m))return;
    const p=x?.price===''||x?.price==null?NaN:parseImportNumber(x.price,NaN);
    byKey.set(m+'|'+leg,Number.isFinite(p)&&p>=0?{m,leg,price:p}:{m,leg});
  });
  return [...byKey.values()].sort((a,b)=>a.m-b.m||a.leg-b.leg);
}
export function pickBreakoutLength(trunkNeeded,legNeeded,lengths){
  const list=lengths||[], eps=1e-9;
  const pick=list.find(x=>x.leg>=legNeeded-eps&&x.m-x.leg>=trunkNeeded-eps);
  if(pick)return{pick:{m:pick.m,leg:pick.leg,price:pick.price??null},reason:null};
  if(!list.length)return{pick:null,reason:'empty'};
  return{pick:null,reason:list.some(x=>x.leg>=legNeeded-eps)?'total':'leg'};
}
// Cada perna, para o resto do app, é um cabo comum da porta da perna até o destino dela.
export function breakoutLegCable(b,l){
  return{id:`${b.id}:${l.lane}`,breakoutId:b.id,name:`${b.name} ${l.lane}`,type:b.type,
    originRack:b.origin.rack,originU:b.origin.u,originFace:b.origin.face,originPortId:l.originPortId||null,originPortLabel:l.originPortLabel||'',originAssetName:b.origin.assetName||'',
    destRack:l.destRack,destU:l.destU,destFace:l.destFace,destPortId:l.destPortId||null,destPortLabel:l.destPortLabel||'',destAssetName:l.destAssetName||'',
    slack:b.slack,routeMode:'automatic',via:[]};
}
function flipCable(c){
  return{...c,originRack:c.destRack,originU:c.destU,originFace:c.destFace,originPortId:c.destPortId,originPortLabel:c.destPortLabel,originAssetName:c.destAssetName,
    destRack:c.originRack,destU:c.originU,destFace:c.originFace,destPortId:c.originPortId,destPortLabel:c.originPortLabel,destAssetName:c.originAssetName};
}
// Separa dos cabos importados as pernas de breakout: tipo breakout/MTP e porta com letra na
// origem (ou no destino — aí a linha é invertida). Mesmo equipamento (rack+U+face) e mesma base
// de porta = um breakout. portLabel(c,'origin'|'dest') devolve o rótulo da porta.
export function groupBreakoutCables(cables,portLabel,isBreakoutType){
  const rest=[], groups=new Map();
  for(const c of cables){
    if(!isBreakoutType(c.type)){rest.push(c);continue;}
    const side=breakoutLane(portLabel(c,'origin'))?'origin':breakoutLane(portLabel(c,'dest'))?'dest':null;
    if(!side){rest.push(c);continue;}
    const f=side==='origin'?c:flipCable(c);
    const {base,lane}=breakoutLane(portLabel(c,side));
    const key=[f.originRack,f.originU,f.originFace,catalogNormalize(base)].join('|');
    if(!groups.has(key))groups.set(key,{name:f.name,type:f.type,slack:f.slack,origin:{rack:f.originRack,u:f.originU,face:f.originFace,assetName:f.originAssetName||''},base,legs:[]});
    const g=groups.get(key);
    if(g.legs.some(l=>l.lane===lane)){rest.push(c);continue;}
    g.legs.push({lane,originPortId:f.originPortId||null,originPortLabel:f.originPortLabel||'',destRack:f.destRack,destU:f.destU,destFace:f.destFace,destPortId:f.destPortId||null,destPortLabel:f.destPortLabel||'',destAssetName:f.destAssetName||''});
  }
  const breakouts=[...groups.values()].map(g=>({...g,legs:g.legs.sort((a,b)=>a.lane.localeCompare(b.lane))}));
  return{cables:rest,breakouts};
}
// Tipo do breakout importado: o próprio nome, se já é tipo de breakout; senão um tipo que
// contenha o nome do cabo e tenha pernas bastantes; senão um novo "<tipo> — breakout 1×N".
export function resolveBreakoutType(typeName,maxLane,breakoutTypes){
  const n=catalogNormalize(typeName), legs=Math.max(4,LANES.indexOf(maxLane)+1);
  const exact=breakoutTypes.find(t=>catalogNormalize(t.name)===n);
  if(exact)return{name:exact.name,created:null};
  const near=breakoutTypes.find(t=>catalogNormalize(t.name).includes(n)&&(t.legs||4)>=legs);
  if(near)return{name:near.name,created:null};
  const name=`${typeName} — breakout 1×${legs}`;
  return{name,created:{name,color:'#2dd4bf',legs,lengths:[]}};
}
```

- [ ] **Step 4: Register the module and run tests**

Run: `node scripts/bump-version.mjs && node --test "js/test/*.test.mjs"`
Expected: all PASS (includes `versions.test.mjs` seeing the new module in the import map).

- [ ] **Step 5: Commit**

```bash
git add js/breakout-model.js js/test/breakout-model.test.mjs index.html app.js js/*.js
git commit -m "feat(breakout): pure model for lanes, supplier lengths and import grouping"
```

---

### Task 2: `calcBreakout` (tronco, perna e produto)

**Files:**
- Modify: `js/routing.js` (append after `calcCable`)
- Test: `js/test/breakout-calc.test.mjs`

**Interfaces:**
- Consumes: `breakoutLegCable`, `pickBreakoutLength` (Task 1); `calcCable`, `routeBetweenRacks` (existing).
- Produces:
  - `breakoutSplit(trays: number[], pairTray: (i,j)=>number) → number`
  - `calcBreakout(b, type) → { reachable, trunkNeeded, legNeeded, pick, reason, legs: [{ lane, total, reachable }] }`

- [ ] **Step 1: Write the failing test** — `js/test/breakout-calc.test.mjs`

```js
// Tronco e perna do breakout a partir das rotas reais, e escolha do produto do fornecedor.
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetState, buildTwoRackScenario } from './helpers.mjs';
import { state } from '../state.js';
import { breakoutSplit, calcBreakout, calcCable } from '../routing.js';

const near = (a, b) => Math.abs(a - b) < 1e-9;

test('divisão em árvore: menor (Ti + Tj − Dij)/2', () => {
  // Origem → calha 8 m → junção; destinos a 2 m e 3 m da junção, 5 m entre eles.
  assert.ok(near(breakoutSplit([10, 11], () => 5), 8));
  // Destinos no mesmo rack: Dij = 0, tronco vai até o rack.
  assert.ok(near(breakoutSplit([10, 10], () => 0), 10));
  // Uma perna só: tronco = trecho de calha inteiro.
  assert.ok(near(breakoutSplit([7], () => 0), 7));
  // Par sem caminho entre si não reduz o tronco.
  assert.ok(near(breakoutSplit([6, 9], () => Infinity), 6));
});

const bo = legs => ({ id: 'b', name: 'B', type: 'MTP', slack: 0, origin: { rack: 'rack0', u: 40, face: 'front', assetName: '' }, legs });
const leg = (lane, destRack, destU = 40) => ({ lane, originPortId: null, destRack, destU, destFace: 'front', destPortId: null });
const type = { lengths: [{ m: 5, leg: 1 }, { m: 10, leg: 1, price: 99 }, { m: 10, leg: 3 }] };

test('pernas no rack remoto: tronco = rota até lá, perna = subida no rack', () => {
  resetState(state); buildTwoRackScenario(state);
  const one = calcCable({ originRack: 'rack0', destRack: 'rack1', originU: 40, destU: 40, slack: 0, routeMode: 'automatic', via: [] });
  const r = calcBreakout(bo([leg('A', 'rack1'), leg('B', 'rack1', 30)]), type);
  assert.equal(r.reachable, true);
  assert.ok(near(r.trunkNeeded, one.v1 + one.tray + 0.30));
  assert.ok(r.legNeeded >= one.v2 + 0.30 - 1e-9);
  assert.deepEqual(r.legs.map(l => l.lane), ['A', 'B']);
});

test('perna no mesmo rack da origem: divisão na porta, perna remota leva a rota inteira', () => {
  resetState(state); buildTwoRackScenario(state);
  const one = calcCable({ originRack: 'rack0', destRack: 'rack1', originU: 40, destU: 40, slack: 0, routeMode: 'automatic', via: [] });
  const r = calcBreakout(bo([leg('A', 'rack0', 30), leg('B', 'rack1')]), type);
  assert.ok(near(r.trunkNeeded, 0.30));
  assert.ok(near(r.legNeeded, one.v1 + one.tray + one.v2 + 0.30));
});

test('folga entra no tronco e na perna; produto escolhido pela tabela', () => {
  resetState(state); buildTwoRackScenario(state);
  const b = bo([leg('A', 'rack1')]); b.slack = 10;
  const r0 = calcBreakout({ ...b, slack: 0 }, type), r = calcBreakout(b, type);
  assert.ok(near(r.trunkNeeded, r0.trunkNeeded * 1.1));
  assert.ok(near(r.legNeeded, r0.legNeeded * 1.1));
  assert.ok(r.pick === null || r.pick.m - r.pick.leg >= r.trunkNeeded);
});

test('perna sem rota deixa o breakout sem rota; perna sem destino é ignorada', () => {
  resetState(state); buildTwoRackScenario(state, { connectTray: false });
  assert.equal(calcBreakout(bo([leg('A', 'rack1')]), type).reachable, false);
  resetState(state); buildTwoRackScenario(state);
  const r = calcBreakout(bo([leg('A', 'rack1'), { lane: 'B', destRack: null }]), type);
  assert.equal(r.reachable, true);
  assert.equal(r.legs.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test js/test/breakout-calc.test.mjs`
Expected: FAIL, `breakoutSplit` / `calcBreakout` not exported.

- [ ] **Step 3: Implement** — `js/routing.js`

Add to the imports at the top of `js/routing.js`:

```js
import { breakoutLegCable, pickBreakoutLength } from './breakout-model.js';
```

Append after `calcCable`:

```js
// Tronco comum das pernas de um breakout, em metros de calha. trays[i] = calha da origem até o
// destino i; pairTray(i,j) = calha entre os destinos i e j. Numa rede em árvore o ponto onde as
// rotas de i e j se separam fica a (Ti + Tj − Dij)/2 da origem; o menor entre os pares (e entre
// as próprias rotas) é o trecho comum a todas.
export function breakoutSplit(trays,pairTray){
  let trunk=Math.min(...trays);
  for(let i=0;i<trays.length;i++)for(let j=i+1;j<trays.length;j++)trunk=Math.min(trunk,(trays[i]+trays[j]-pairTray(i,j))/2);
  return Math.max(0,trunk);
}
// Breakout: rota de cada perna pelo motor de sempre (folga 0), tronco até a divisão e a maior
// perna depois dela, cada um com 0,30 m de conexão e a folga % do breakout. Se alguma perna
// termina no próprio rack da origem, a divisão é na porta. O produto vem de type.lengths.
export function calcBreakout(b,type){
  const legs=(b.legs||[]).filter(l=>l.destRack);
  const res=legs.map(l=>({lane:l.lane,...calcCable({...breakoutLegCable(b,l),slack:0})}));
  const out=res.map(r=>({lane:r.lane,total:r.total,reachable:r.reachable}));
  if(!res.length||!res.every(r=>r.reachable))return{reachable:false,trunkNeeded:0,legNeeded:0,pick:null,reason:null,legs:out};
  const k=1+num(b.slack,state.defaultSlack)/100;
  const atOrigin=legs.map(l=>l.destRack===b.origin.rack);
  let trunkNeeded,legNeeded;
  if(atOrigin.some(Boolean)){
    trunkNeeded=0.30;
    legNeeded=Math.max(...res.map((r,i)=>atOrigin[i]?r.v1+0.30:r.v1+r.tray+r.v2+0.30));
  }else{
    const trunkTray=breakoutSplit(res.map(r=>r.tray),(i,j)=>legs[i].destRack===legs[j].destRack?0:(routeBetweenRacks(legs[i].destRack,legs[j].destRack,{})?.length??Infinity));
    trunkNeeded=Math.max(...res.map(r=>r.v1))+trunkTray+0.30;
    legNeeded=Math.max(...res.map(r=>r.tray-trunkTray+r.v2+0.30));
  }
  trunkNeeded*=k; legNeeded*=k;
  const {pick,reason}=pickBreakoutLength(trunkNeeded,legNeeded,type?.lengths);
  return{reachable:true,trunkNeeded,legNeeded,pick,reason,legs:out};
}
```

- [ ] **Step 4: Run tests**

Run: `node --test "js/test/*.test.mjs"`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add js/routing.js js/test/breakout-calc.test.mjs
git commit -m "feat(breakout): trunk/leg calculation over the real tray routes"
```

---

### Task 3: Estado, salas e catálogo de tipos de breakout

**Files:**
- Modify: `js/state.js:25` (default `breakouts: []`)
- Modify: `app.js:38-40` (`ROOM_KEYS`, `applyRoomData`), `app.js:94-105` (`normalizeCableCatalogs`)
- Modify: `js/catalogs.js:194` (base de sala nova), `js/catalogs.js` (render da seção nova)
- Modify: `index.html` (seção "Tipos de breakout" no modal de catálogos, logo após a seção de tipos de cabo), `app.css`
- Test: `js/test/breakout-model.test.mjs` (normalização já coberta); verificação no navegador

**Interfaces:**
- Consumes: `normalizeBreakoutLengths` (Task 1).
- Produces: `state.breakouts` (array por sala); `state.cableCatalogs.breakoutTypes: [{ name, color, legs, lengths }]`; `renderBreakoutTypesCatalog()` exportado de `js/catalogs.js`.

- [ ] **Step 1: State and rooms**

`js/state.js` line 25: add `breakouts: [],` next to `cables: []`.

`app.js:38`: add `'breakouts'` to `ROOM_KEYS` right after `'cables'`.

`app.js:40` `applyRoomData`: after the `ROOM_KEYS.forEach(...)` add

```js
  // Sala salva antes do breakout não tem a chave: sem isto, herdaria os da sala anterior.
  if(data.breakouts===undefined)state.breakouts=[];
```

`js/catalogs.js:194`: add `breakouts:[],` next to `cables:[],` in the new-room `base` object.

Find the project-load normalizer that fixes `state.cables` (`app.js:465-468`) and add right after line 468:

```js
  state.breakouts=(Array.isArray(state.breakouts)?state.breakouts:[]).filter(b=>b?.origin&&rackIds.has(b.origin.rack));
  state.breakouts.forEach(b=>{b.legs=(b.legs||[]).map(l=>rackIds.has(l.destRack)?l:{...l,destRack:null,destPortId:null});});
```

- [ ] **Step 2: Catalog normalization** — in `normalizeCableCatalogs` (`app.js`), before the final line, add:

```js
  // Tipos de breakout: nome único, cor, nº de pernas (1–8) e os produtos { m, leg, price? }.
  const bSeen=new Set();
  state.cableCatalogs.breakoutTypes=(Array.isArray(state.cableCatalogs.breakoutTypes)?state.cableCatalogs.breakoutTypes:[]).filter(t=>{
    const name=String(t?.name||'').trim(), key=catalogNormalize(name);
    if(!name||bSeen.has(key))return false; bSeen.add(key);
    Object.assign(t,{name,color:/^#[0-9a-fA-F]{6}$/.test(t.color||'')?t.color:'#2dd4bf',legs:Math.min(8,Math.max(1,Math.floor(num(t.legs,4)))),lengths:normalizeBreakoutLengths(t.lengths)});
    return true;
  });
```

Import `normalizeBreakoutLengths` in `app.js` from `./js/breakout-model.js`, and add `function breakoutTypeOf(name){normalizeCableCatalogs();return state.cableCatalogs.breakoutTypes.find(t=>t.name===name)||null;}` next to `cableTypeColor`.

- [ ] **Step 3: Catalog section markup** — `index.html`, copy the "Tipos de cabo" `<section class="catalog-section">` block (the one containing `id="catalogCableTypeAdd"`, `catalogCableTypeSearch`, `catalogCableTypes`) and paste it right after, renaming: title "Tipos de breakout", subtitle "Cabos MTP com pernas, e os tamanhos do fornecedor", ids `catalogBreakoutTypeAdd`, `catalogBreakoutTypeSearch`, `catalogBreakoutTypes`, placeholder "Buscar tipo de breakout...". Remove the import/export icon buttons from the copy.

- [ ] **Step 4: Catalog render** — `js/catalogs.js`, add after `renderCableTypesCatalog` (reuses the lengths-panel CSS `.catalog-lengths`, `.catalog-length-row`, `.catalog-length-head`):

```js
// Tipos de breakout: nome, cor, nº de pernas e os produtos do fornecedor (total, perna, preço).
const openBreakoutLengths=new Set();
function breakoutLengthRow(l={}){
  return `<div class="catalog-length-row is-3"><input type="number" min="0" max="999.99" step="0.01" data-bo-m value="${l.m??''}" placeholder="0" aria-label="Total (m)"><input type="number" min="0" max="999.99" step="0.01" data-bo-leg value="${l.leg??''}" placeholder="0" aria-label="Perna (m)"><input type="number" min="0" max="9999.99" step="0.01" data-bo-price value="${l.price??''}" placeholder="0,00" aria-label="Preço (R$), opcional"><button type="button" class="iconbtn danger-icon" data-len-remove title="Remover tamanho">${uiIcon('close')}</button></div>`;
}
export function renderBreakoutTypesCatalog(){
  normalizeCableCatalogs();
  const el=$('catalogBreakoutTypes'); if(!el)return;
  const types=state.cableCatalogs.breakoutTypes;
  const q=String($('catalogBreakoutTypeSearch')?.value||'').toLowerCase().trim();
  el.innerHTML=types.map((t,i)=>({t,i})).filter(({t})=>!q||t.name.toLowerCase().includes(q)).map(({t,i})=>{
    const open=openBreakoutLengths.has(t.name);
    return `<div class="catalog-row"><span title="${esc(t.name)}">${esc(t.name)} · ${t.legs} pernas</span><div><button type="button" class="iconbtn catalog-lengths-toggle${open?' active':''}" data-bo-lengths="${i}" title="Tamanhos e preços" aria-expanded="${open}">${RULER_ICON}${t.lengths.length?`<b>${t.lengths.length}</b>`:''}</button><input type="color" class="catalog-color-swatch" data-bo-color="${i}" value="${esc(t.color)}" title="Cor deste tipo"><button type="button" class="iconbtn" data-bo-edit="${i}" title="Editar">${uiIcon('pencil')}</button><button type="button" class="iconbtn danger-icon" data-bo-delete="${i}" title="Excluir">${uiIcon('close')}</button></div></div>`
      +(open?`<div class="catalog-lengths" data-bo-panel="${i}"><small>Tamanhos que o fornecedor vende: total e perna, preço opcional. O sistema escolhe o menor que alcança todos os destinos.</small><div class="catalog-length-row is-3 catalog-length-head" aria-hidden="true"><span>Total</span><span>Perna</span><span>Preço (R$)</span><i></i></div>${t.lengths.map(breakoutLengthRow).join('')}<button type="button" class="btn small" data-len-add>${uiIcon('plus')} Adicionar tamanho</button></div>`:'');
  }).join('')||'<div class="empty">Nenhum tipo de breakout. A importação cria um quando encontra cabos MTP.</div>';
  el.querySelectorAll('[data-bo-lengths]').forEach(btn=>btn.onclick=()=>{const n=types[Number(btn.dataset.boLengths)].name;openBreakoutLengths.has(n)?openBreakoutLengths.delete(n):openBreakoutLengths.add(n);renderBreakoutTypesCatalog();});
  el.querySelectorAll('[data-bo-color]').forEach(inp=>{inp.oninput=()=>{types[Number(inp.dataset.boColor)].color=inp.value;};inp.onchange=()=>{save();renderAll(false);};});
  el.querySelectorAll('[data-bo-edit]').forEach(btn=>btn.onclick=async()=>{
    const t=types[Number(btn.dataset.boEdit)], old=t.name;
    const name=await uiPrompt('Nome do tipo de breakout.',old,{title:'Editar tipo de breakout',label:'Nome',confirmText:'Salvar'}); if(name===null)return;
    const legs=await uiPrompt('Quantas pernas (1 a 8)?',String(t.legs),{title:'Pernas',label:'Pernas',confirmText:'Salvar'}); if(legs===null)return;
    const trimmed=name.trim(); if(!trimmed){toast('Nome não pode ficar vazio.');return;}
    if(types.some(x=>x!==t&&catalogNormalize(x.name)===catalogNormalize(trimmed))){toast('Já existe um tipo de breakout com esse nome.');return;}
    t.name=trimmed; t.legs=num(legs,t.legs);
    (state.rooms||[]).forEach(r=>(r.data?.breakouts||[]).forEach(b=>{if(b.type===old)b.type=trimmed;}));
    state.breakouts.forEach(b=>{if(b.type===old)b.type=trimmed;});
    if(openBreakoutLengths.delete(old))openBreakoutLengths.add(trimmed);
    save();renderAll();renderBreakoutTypesCatalog();
  });
  el.querySelectorAll('[data-bo-delete]').forEach(btn=>btn.onclick=async()=>{
    const idx=Number(btn.dataset.boDelete), name=types[idx].name, inUse=state.breakouts.filter(b=>b.type===name).length;
    if(inUse){toast(`${inUse} breakout(s) usam esse tipo. Troque o tipo deles antes de excluir.`);return;}
    if(!await uiConfirm('',{title:`Excluir "${name}"?`,confirmText:'Excluir',danger:true}))return;
    types.splice(idx,1); save();renderBreakoutTypesCatalog();
  });
  el.querySelectorAll('[data-bo-panel]').forEach(panel=>{
    const commit=()=>{types[Number(panel.dataset.boPanel)].lengths=normalizeBreakoutLengths([...panel.querySelectorAll('.catalog-length-row:not(.catalog-length-head)')]
      .map(r=>({m:r.querySelector('[data-bo-m]').value,leg:r.querySelector('[data-bo-leg]').value,price:r.querySelector('[data-bo-price]').value})));save();renderAll(false);};
    panel.addEventListener('change',commit);
    panel.addEventListener('input',e=>{
      const lim=e.target.matches('[data-bo-price]')?4:e.target.matches('[data-bo-m],[data-bo-leg]')?3:0;
      const v=e.target.value; if(!lim||!v)return;
      const [int,dec]=v.split('.'); const cut=int.slice(0,lim)+(dec!=null?'.'+dec.slice(0,2):'');
      if(cut!==v)e.target.value=cut.replace(/\.$/,'');
    });
    panel.addEventListener('click',e=>{
      if(e.target.closest('[data-len-add]')){e.target.closest('[data-len-add]').insertAdjacentHTML('beforebegin',breakoutLengthRow());panel.querySelector('.catalog-length-row:last-of-type [data-bo-m]')?.focus();}
      else if(e.target.closest('[data-len-remove]')){e.target.closest('.catalog-length-row').remove();commit();}
    });
  });
}
```

Add `normalizeBreakoutLengths` to the imports of `js/catalogs.js` (from `./breakout-model.js`) and `uiConfirm` if missing. Call `renderBreakoutTypesCatalog()` wherever `renderCableTypesCatalog()` is called when the catalogs modal opens (`grep -n "renderCableTypesCatalog()" app.js`). Wire in `app.js` next to `catalogCableTypeSearch` (line ~4375):

```js
  $('catalogBreakoutTypeSearch')?.addEventListener('input',renderBreakoutTypesCatalog);
  $('catalogBreakoutTypeAdd')?.addEventListener('click',async()=>{
    normalizeCableCatalogs();
    const name=await uiPrompt('Ex.: MTP-8 → 4× LC OM4','',{title:'Novo tipo de breakout',label:'Nome',confirmText:'Adicionar'});
    if(name===null)return; const trimmed=name.trim();
    if(!trimmed){toast('Nome não pode ficar vazio.');return;}
    if(state.cableCatalogs.breakoutTypes.some(t=>catalogNormalize(t.name)===catalogNormalize(trimmed))){toast('Já existe um tipo de breakout com esse nome.');return;}
    state.cableCatalogs.breakoutTypes.push({name:trimmed,color:'#2dd4bf',legs:4,lengths:[]});
    save();renderBreakoutTypesCatalog();
  });
```

- [ ] **Step 5: CSS** — `app.css`, after the `.catalog-length-row` block:

```css
.catalog-length-row.is-3 {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.2fr) 24px;
}
```

- [ ] **Step 6: Verify** — `node scripts/bump-version.mjs css && node --test "js/test/*.test.mjs"` all PASS. Serve (`python -m http.server 8765`), enter as guest, open Catálogos: add a breakout type, add sizes 5/1/180 and 10/1, reload the catalog, sizes stay sorted; switch to a second room and back — no breakout leaks between rooms (`state.breakouts` via `await import('./js/state.js')`).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(breakout): breakout types catalog and per-room state"
```

---

### Task 4: Integração — portas, canvas, seleção, rack apagado

**Files:**
- Modify: `app.js` (`allProjectCables` ~1933, `cablePortConflict` ~1848, rack deletion ~587, selection validity ~294, canvas ~1440, `renderPropertiesBody` ~3176, assets export ~3439)

**Interfaces:**
- Consumes: `breakoutLegCable` (Task 1), `state.breakouts` (Task 3).
- Produces: `breakoutLegCables(breakouts=state.breakouts) → cable-like[]` in `app.js`, passed to `configureBreakouts` in Task 5.

- [ ] **Step 1: Leg cables helper** — in `app.js` next to `allProjectCables`:

```js
// Pernas de breakout como cabos virtuais: é assim que porta ocupada, conflito e desenho de
// rota enxergam o breakout, sem código próprio.
function breakoutLegCables(list=state.breakouts){return (list||[]).flatMap(b=>(b.legs||[]).filter(l=>l.destRack).map(l=>breakoutLegCable(b,l)));}
```

Import `breakoutLegCable` from `./js/breakout-model.js`.

- [ ] **Step 2: Ports** —
  - `allProjectCables`: return `[...(state.cables||[]), ...breakoutLegCables(), ...others, ...(state.rooms||[]).filter(r=>r.id!==activeId).flatMap(r=>breakoutLegCables(r.data?.breakouts))]` (keep the existing `others` line).
  - `cablePortConflict`: replace `state.cables.find(` with `[...state.cables,...breakoutLegCables()].find(` and skip legs of the same breakout: add `&& !(cable.breakoutId && c.breakoutId===cable.breakoutId)` to the predicate.
  - Assets export (`app.js:~3439`): `const cables=[...(roomCables.get(a.roomId)||[]), ...breakoutLegCables((state.rooms||[]).find(r=>r.id===a.roomId)?.data?.breakouts ?? (a.roomId===state.activeRoomId?state.breakouts:[]))];` — check the active-room field name with `grep -n "activeRoomId\|currentRoomId" app.js | head -3` and use that name.

- [ ] **Step 3: Rack deletion** — after `app.js:588` (`state.cables.forEach(c=>c.via=...)`):

```js
  state.breakouts=state.breakouts.filter(b=>!set.has(b.origin.rack));
  state.breakouts.forEach(b=>b.legs.forEach(l=>{if(set.has(l.destRack)){l.destRack=null;l.destPortId=null;}}));
```

- [ ] **Step 4: Selection validity** — `app.js:294`: extend the condition with `|| (selectionState.selected.type==='breakout' && (state.breakouts||[]).some(b=>b.id===selectionState.selected.id))`.

- [ ] **Step 5: Canvas** — `app.js:1440`, before `if(state.selected?.type==='cable'){`:

```js
  if(state.selected?.type==='breakout'){
    const b=state.breakouts.find(x=>x.id===state.selected.id);
    const color=breakoutTypeOf(b?.type)?.color||'var(--route)';
    breakoutLegCables(b?[b]:[]).forEach(c=>{
      const pts=computeRoute(c,g);
      if(pts.length>1)svg.insertAdjacentHTML('beforeend',`<polyline class="route-line" style="--cable-color:${color}" points="${pts.map(p=>p.x+','+p.y).join(' ')}"/>`);
    });
  }
```

- [ ] **Step 6: Properties dispatch** — `app.js:3176`, next line: `if(state.selected.type==='breakout')renderBreakoutProperties(p,state.breakouts.find(x=>x.id===state.selected.id));` (function comes from Task 5; until then add a temporary import-free stub is **not** allowed — do Task 5 in the same session before running the page).

- [ ] **Step 7: Verify** — `node --test "js/test/*.test.mjs"` PASS (modules test checks imports). Browser check happens at the end of Task 5.

- [ ] **Step 8: Commit** (together with Task 5 if Step 6 needs it to load)

---

### Task 5: `js/breakouts.js` — aba, lista, painel, adicionar

**Files:**
- Create: `js/breakouts.js`
- Modify: `index.html` (abas no card Cabos), `app.css`, `app.js` (import + `configureBreakouts`)

**Interfaces:**
- Consumes: `calcBreakout` (Task 2), `breakoutLane` (Task 1), from `app.js` via `configureBreakouts({ toast, save, renderAll, breakoutTypeOf, breakoutLegCables, cablePortConflict, flashSelection })`.
- Produces: `breakouts` UI state object `{ tab: 'cables'|'breakouts', query: '' }`; `renderBreakoutsList()`, `renderBreakoutProperties(p, b)`, `addBreakout()`, `breakoutSummaryRows()`, `breakoutExportRows()`.

- [ ] **Step 1: Tabs markup** — `index.html`, inside `.cables-section`, right under `.cables-head`, add:

```html
<div class="cables-tabs" role="tablist">
  <button type="button" role="tab" class="cables-tab active" data-cables-tab="cables" aria-selected="true">Cabos <b id="cablesTabCount">0</b></button>
  <button type="button" role="tab" class="cables-tab" data-cables-tab="breakouts" aria-selected="false">Breakouts <b id="breakoutsTabCount">0</b></button>
</div>
<div id="breakoutsPane" class="breakouts-pane" hidden>
  <div class="breakouts-toolbar"><input id="breakoutSearch" type="search" placeholder="Buscar breakout, rack, porta..." autocomplete="off"><button type="button" id="btnAddBreakout" class="btn primary small">+ Breakout</button></div>
  <div id="breakoutsList" class="breakouts-list"></div>
</div>
```

The existing cables list container (toolbar + list after the tabs) gets wrapped in `<div id="cablesPane">…</div>` so the tab can hide it.

- [ ] **Step 2: Module** — `js/breakouts.js`:

```js
// Cabos MTP breakout: aba "Breakouts" do card Cabos, painel de propriedades, novo breakout e
// as linhas de resumo/export. A conta fica em routing.js (calcBreakout); o modelo em
// breakout-model.js.
import { uid, esc, num, $, uiIcon, formatBRL } from './utils.js';
import { state } from './state.js';
import { rackDisplayName } from './geometry.js';
import { calcBreakout } from './routing.js';
import { breakoutLane } from './breakout-model.js';
import { assetAtRackU } from './occupancy.js';
export const breakouts = { tab: 'cables', query: '' };
let toast, save, renderAll, breakoutTypeOf, breakoutLegCables, cablePortConflict, flashSelection;
export function configureBreakouts(deps){
  ({ toast, save, renderAll, breakoutTypeOf, breakoutLegCables, cablePortConflict, flashSelection } = deps);
}
const rackName=id=>{const r=state.racks.find(x=>x.id===id);return r?rackDisplayName(r):'—';};
const fmtM=v=>`${num(v,0).toFixed(2).replace('.',',')} m`;
function reasonText(r,type){
  if(r.reason==='empty')return `Cadastre os tamanhos de "${type}" no catálogo.`;
  if(r.reason==='leg')return 'Destinos muito distantes para este breakout — considere tronco MTP + cassete.';
  if(r.reason==='total')return 'Passa do maior tamanho cadastrado para este tipo.';
  return '';
}
export function breakoutCalc(b){return calcBreakout(b,breakoutTypeOf(b.type));}
export function setCablesTab(tab){
  breakouts.tab=tab;
  document.querySelectorAll('[data-cables-tab]').forEach(t=>{const on=t.dataset.cablesTab===tab;t.classList.toggle('active',on);t.setAttribute('aria-selected',String(on));});
  $('cablesPane')&&($('cablesPane').hidden=tab!=='cables');
  $('breakoutsPane')&&($('breakoutsPane').hidden=tab!=='breakouts');
  renderBreakoutsList();
}
export function renderBreakoutsList(){
  const el=$('breakoutsList'); if(!el)return;
  $('breakoutsTabCount')&&($('breakoutsTabCount').textContent=state.breakouts.length);
  $('cablesTabCount')&&($('cablesTabCount').textContent=state.cables.length);
  const q=breakouts.query.toLowerCase().trim();
  const hay=b=>[b.name,b.type,rackName(b.origin.rack),b.origin.assetName,...b.legs.flatMap(l=>[l.lane,rackName(l.destRack),l.destAssetName,l.destPortLabel])].join(' ').toLowerCase();
  const list=state.breakouts.filter(b=>!q||hay(b).includes(q));
  el.innerHTML=list.map(b=>{
    const r=breakoutCalc(b), color=breakoutTypeOf(b.type)?.color||'var(--route)';
    const size=!r.reachable?'sem rota':r.pick?`${r.pick.m} m · pernas ${r.pick.leg} m`:'⚠';
    const sel=state.selected?.type==='breakout'&&state.selected.id===b.id;
    return `<div class="cable-item breakout-item ${sel?'selected':''}" style="--cable-color:${esc(color)};border-left-color:${esc(color)}" data-breakout="${b.id}">
      <div class="cable-item-main"><div class="cable-name-row"><span class="cable-name">${esc(b.name)}</span><span class="cable-len">${esc(size)}</span></div>
      <div class="breakout-legs">${b.legs.map(l=>`<div class="cable-end"><i></i><span class="cable-end-text">${esc(l.lane)} → ${esc(l.destRack?[rackName(l.destRack),'U'+l.destU,l.destAssetName||'—',l.destPortLabel||'—'].join(' · '):'livre')}</span></div>`).join('')}</div></div></div>`;
  }).join('')||'<div class="empty">Nenhum breakout. Importe a planilha de cabos (tipo MTP/breakout e portas 1A, 1B…) ou clique em "+ Breakout".</div>';
  el.querySelectorAll('[data-breakout]').forEach(it=>it.onclick=()=>{state.selected={type:'breakout',id:it.dataset.breakout};state.multiSelected=[];renderAll(false);flashSelection?.();});
}
// Portas do equipamento de origem agrupadas pela base (1 → 1A,1B,1C,1D).
function laneGroups(asset){
  const m=new Map();
  (asset?.ports||[]).forEach(p=>{const l=breakoutLane(p.label);if(!l)return;if(!m.has(l.base))m.set(l.base,[]);m.get(l.base).push({...l,port:p});});
  return m;
}
export function addBreakout(){
  if(!state.racks.length){toast('Crie racks primeiro.');return;}
  const types=state.cableCatalogs.breakoutTypes||[];
  if(!types.length){toast('Cadastre um tipo de breakout no catálogo primeiro.');return;}
  const r=state.racks[0];
  const b={id:uid('breakout'),name:`Breakout-${String(state.breakouts.length+1).padStart(3,'0')}`,type:types[0].name,slack:state.defaultSlack,
    origin:{rack:r.id,u:r.units,face:'front',assetName:''},base:'',legs:[]};
  state.breakouts.push(b); state.selected={type:'breakout',id:b.id}; setCablesTab('breakouts'); renderAll(); toast('Breakout adicionado');
}
export function renderBreakoutProperties(p,b){
  if(!b){p.innerHTML='';return;}
  const types=state.cableCatalogs.breakoutTypes||[];
  const asset=assetAtRackU(state.assets,b.origin.rack,b.origin.u,b.origin.face);
  const groups=laneGroups(asset);
  const r=breakoutCalc(b);
  const rackOpts=sel=>state.racks.map(x=>`<option value="${x.id}" ${x.id===sel?'selected':''}>${esc(rackDisplayName(x))}</option>`).join('');
  const destPorts=l=>{const a=l.destRack?assetAtRackU(state.assets,l.destRack,l.destU,l.destFace):null;return '<option value="">— Nenhuma —</option>'+(a?.ports||[]).map(pt=>`<option value="${esc(pt.id)}" ${pt.id===l.destPortId?'selected':''}>${esc(pt.label)}</option>`).join('');};
  const legRow=(l,i)=>{const conflict=l.destPortId?cablePortConflict(breakoutLegCables([b]).find(c=>c.id===`${b.id}:${l.lane}`)||{},'dest',l.destPortId):null;
    return `<div class="breakout-leg" data-leg="${i}"><b>${esc(l.lane)}</b><select data-leg-rack><option value="">— livre —</option>${rackOpts(l.destRack)}</select><input type="number" min="1" data-leg-u value="${l.destU??''}" placeholder="U"><select data-leg-face><option value="front">Frente</option><option value="rear" ${l.destFace==='rear'?'selected':''}>Traseira</option></select><select data-leg-port>${destPorts(l)}</select>${conflict?`<div class="field-error">Porta já usada por "${esc(conflict.name)}".</div>`:''}</div>`;};
  const pick=r.pick;
  p.innerHTML=`<div class="prop-group breakout-props">
    <label class="prop-field">Nome<input id="boName" value="${esc(b.name)}"></label>
    <label class="prop-field">Tipo<select id="boType">${types.map(t=>`<option ${t.name===b.type?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label>
    <div class="prop-subtitle">Origem (ponta MTP)</div>
    <label class="prop-field">Rack<select id="boRack">${rackOpts(b.origin.rack)}</select></label>
    <label class="prop-field">U<input id="boU" type="number" min="1" value="${b.origin.u}"></label>
    <label class="prop-field">Face<select id="boFace"><option value="front">Frente</option><option value="rear" ${b.origin.face==='rear'?'selected':''}>Traseira</option></select></label>
    <label class="prop-field">Porta MTP<select id="boBase"><option value="">—</option>${[...groups.keys()].map(k=>`<option ${k===b.base?'selected':''}>${esc(k)}</option>`).join('')}</select></label>
    ${asset&&!groups.size?'<div class="field-error">Este equipamento não tem portas no formato 1A, 1B…</div>':''}
    <div class="prop-subtitle">Pernas</div>
    ${b.legs.map(legRow).join('')||'<div class="empty">Escolha a porta MTP para listar as pernas.</div>'}
    <label class="prop-field">Folga (%)<input id="boSlack" type="number" min="0" step="1" value="${b.slack??state.defaultSlack}"></label>
    <div class="breakout-result">
      ${!r.reachable?'<div class="unreachable">Alguma perna não tem rota pelas calhas.</div>':`
      <div class="cable-metric"><span class="cable-metric-label">Tronco necessário</span><b>${fmtM(r.trunkNeeded)}</b></div>
      <div class="cable-metric"><span class="cable-metric-label">Perna necessária</span><b>${fmtM(r.legNeeded)}</b></div>
      ${pick?`<div class="cable-metric is-rounded"><span class="cable-metric-label">Cabo escolhido</span><b>${pick.m} m · pernas ${pick.leg} m · tronco ${Math.round((pick.m-pick.leg)*100)/100} m</b></div>`:''}
      ${pick?.price!=null?`<div class="cable-metric is-price"><span class="cable-metric-label">Preço</span><b>${formatBRL(pick.price)}</b></div>`:''}
      ${r.reason?`<div class="validation-error">${uiIcon('warn')} ${esc(reasonText(r,b.type))}</div>`:''}`}
    </div>
    <button type="button" id="delBreakout" class="btn danger small">${uiIcon('trash')} Excluir breakout</button>
  </div>`;
  const upd=fn=>()=>{fn();save();renderAll(false);};
  $('boName').onchange=upd(()=>{b.name=$('boName').value.trim()||b.name;});
  $('boType').onchange=upd(()=>{b.type=$('boType').value;});
  $('boSlack').onchange=upd(()=>{b.slack=Math.max(0,num($('boSlack').value,0));});
  const resetOrigin=()=>{b.base='';b.legs=[];b.origin.assetName=assetAtRackU(state.assets,b.origin.rack,b.origin.u,b.origin.face)?.name||'';};
  $('boRack').onchange=upd(()=>{b.origin.rack=$('boRack').value;resetOrigin();});
  $('boU').onchange=upd(()=>{b.origin.u=Math.max(1,Math.floor(num($('boU').value,1)));resetOrigin();});
  $('boFace').onchange=upd(()=>{b.origin.face=$('boFace').value==='rear'?'rear':'front';resetOrigin();});
  $('boBase').onchange=upd(()=>{
    const old=new Map(b.legs.map(l=>[l.lane,l])); b.base=$('boBase').value;
    b.legs=(groups.get(b.base)||[]).sort((x,y)=>x.lane.localeCompare(y.lane)).map(g=>({...(old.get(g.lane)||{destRack:null,destU:null,destFace:'front',destPortId:null,destPortLabel:'',destAssetName:''}),lane:g.lane,originPortId:g.port.id,originPortLabel:''}));
  });
  p.querySelectorAll('[data-leg]').forEach(row=>{
    const l=b.legs[Number(row.dataset.leg)];
    const destAsset=()=>l.destRack?assetAtRackU(state.assets,l.destRack,l.destU,l.destFace):null;
    const reset=()=>{l.destPortId=null;l.destPortLabel='';l.destAssetName=destAsset()?.name||'';};
    row.querySelector('[data-leg-rack]').onchange=upd(()=>{l.destRack=row.querySelector('[data-leg-rack]').value||null;l.destU=l.destU||state.racks.find(x=>x.id===l.destRack)?.units||1;reset();});
    row.querySelector('[data-leg-u]').onchange=upd(()=>{l.destU=Math.max(1,Math.floor(num(row.querySelector('[data-leg-u]').value,1)));reset();});
    row.querySelector('[data-leg-face]').onchange=upd(()=>{l.destFace=row.querySelector('[data-leg-face]').value==='rear'?'rear':'front';reset();});
    row.querySelector('[data-leg-port]').onchange=upd(()=>{l.destPortId=row.querySelector('[data-leg-port]').value||null;});
  });
  $('delBreakout').onclick=()=>{state.breakouts=state.breakouts.filter(x=>x!==b);state.selected=null;renderAll();toast('Breakout excluído');};
}
// Resumo de compra: 1 item por breakout, agrupado por tipo + total + perna.
export function breakoutSummaryRows(list=state.breakouts){
  const groups=new Map(); let noPick=0;
  for(const b of list){
    const r=breakoutCalc(b);
    if(!r.pick){noPick++;continue;}
    const key=`${b.type}|${r.pick.m}|${r.pick.leg}`;
    const g=groups.get(key)||{type:b.type,m:r.pick.m,leg:r.pick.leg,price:r.pick.price,qty:0};
    g.qty++; groups.set(key,g);
  }
  return{rows:[...groups.values()].sort((a,b)=>a.type.localeCompare(b.type)||a.m-b.m||a.leg-b.leg),noPick};
}
```

- [ ] **Step 3: Wire in `app.js`** — import `{ breakouts, configureBreakouts, setCablesTab, renderBreakoutsList, renderBreakoutProperties, addBreakout, breakoutSummaryRows, breakoutCalc }` from `./js/breakouts.js`; right after `configureCables(...)` call `configureBreakouts({ toast, save, renderAll, breakoutTypeOf, breakoutLegCables, cablePortConflict, flashSelection });`. In `renderAll` add `renderBreakoutsList();` after `renderCables();`. In the init block (next to `btnAddCablePanel` handlers):

```js
  document.querySelectorAll('[data-cables-tab]').forEach(t=>t.onclick=()=>setCablesTab(t.dataset.cablesTab));
  $('btnAddBreakout')?.addEventListener('click',addBreakout);
  $('breakoutSearch')?.addEventListener('input',e=>{breakouts.query=e.target.value;renderBreakoutsList();});
```

- [ ] **Step 4: CSS** — `app.css`, near `.cables-count`:

```css
.cables-tabs { display: flex; gap: 4px; padding: 0 12px 8px; }
.cables-tab { flex: 1; padding: 6px 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--panel2); color: var(--muted); font-size: var(--fs-micro); cursor: pointer; }
.cables-tab.active { color: var(--text); border-color: color-mix(in srgb, var(--blue) 45%, var(--border)); background: color-mix(in srgb, var(--blue) 8%, var(--panel2)); }
.cables-tab b { margin-left: 4px; font-weight: 600; }
.breakouts-toolbar { display: flex; gap: 6px; padding: 0 12px 8px; }
.breakouts-toolbar input { flex: 1; min-width: 0; }
.breakouts-list { display: grid; gap: 6px; padding: 0 12px 12px; overflow: auto; }
.breakout-legs { display: grid; gap: 2px; margin-top: 4px; }
.breakout-leg { display: grid; grid-template-columns: 18px minmax(0, 1.4fr) 52px minmax(0, 1fr) minmax(0, 1.2fr); gap: 4px; align-items: center; margin-bottom: 4px; }
.breakout-leg .field-error { grid-column: 2 / -1; }
.breakout-result { display: grid; gap: 4px; margin: 8px 0; }
```

(Check the token names `--text`/`--panel2` exist with `grep -n "^\s*--text:" app.css`; use the name found.)

- [ ] **Step 5: Verify** — `node scripts/bump-version.mjs css && node --test "js/test/*.test.mjs"` PASS. Browser (guest): 1 row × 3 racks, "+ Calha", add a switch asset with ports `1A–1D` in rack 1 (asset editor), "+ Breakout", choose origin rack/U, Porta MTP `1`, set legs A→rack 2, B→rack 3. Check: list shows 1 breakout with 2 legs; panel shows tronco/perna/escolhido; canvas draws 2 lines; choosing a leg port used by a normal cable shows "Porta já usada"; deleting rack 3 leaves leg B "livre".

- [ ] **Step 6: Commit** (Tasks 4+5)

```bash
git add -A && git commit -m "feat(breakout): breakouts tab, properties panel, canvas and port occupancy"
```

---

### Task 6: Importação automática

**Files:**
- Modify: `js/cables.js` (`processCableImportRows` ~215-290, type review ~175-190)

**Interfaces:**
- Consumes: `groupBreakoutCables`, `isBreakoutTypeName`, `resolveBreakoutType` (Task 1).

- [ ] **Step 1: Skip breakout type names in the "new cable types" review** — in the `dataRows.forEach` that fills `newTypesSeen` (`js/cables.js:~179`), after `if(!raw)return;` add:

```js
          if(isBreakoutTypeName(raw,state.cableCatalogs.breakoutTypes||[]))return;
```

- [ ] **Step 2: Collect instead of push, then group** — in `processCableImportRows`, before the `for(const row of dataRows)` loop add `const imported=[];`; replace `state.cables.push({...});` with `imported.push({...});` (same object). Keep the port labels for grouping: add `originLabel:originPortLabel,destLabel:destPortLabel` to the pushed object. After the loop, before `renderAll();`:

```js
  // Cabos MTP/breakout com porta 1A…1H viram um breakout por equipamento + porta (1A–1D = um).
  normalizeCableCatalogs();
  const boTypes=state.cableCatalogs.breakoutTypes;
  const grouped=groupBreakoutCables(imported,(c,side)=>side==='origin'?c.originLabel:c.destLabel,t=>isBreakoutTypeName(t,boTypes));
  let typesCreated=0;
  for(const g of grouped.breakouts){
    const maxLane=g.legs.map(l=>l.lane).sort().at(-1);
    const r=resolveBreakoutType(g.type,maxLane,boTypes);
    if(r.created){boTypes.push({...r.created,color:cableTypeColor(g.type)?.startsWith('#')?cableTypeColor(g.type):r.created.color});typesCreated++;}
    state.breakouts.push({...g,id:uid('breakout'),type:r.name});
  }
  grouped.cables.forEach(c=>{delete c.originLabel;delete c.destLabel;state.cables.push(c);});
  added=grouped.cables.length;
```

Change the toast parts to:

```js
  const legRows=grouped.breakouts.reduce((s,b)=>s+b.legs.length,0);
  const parts=[`${added} cabo(s) importado(s).`];
  if(grouped.breakouts.length)parts.push(`${grouped.breakouts.length} breakout(s) detectado(s) (${legRows} linhas).`);
  if(typesCreated)parts.push(`${typesCreated} tipo(s) de breakout criado(s).`);
```

Import `groupBreakoutCables, isBreakoutTypeName, resolveBreakoutType` from `./breakout-model.js`. `cableTypeColor` is already injected into `cables.js`.

- [ ] **Step 3: Verify** — `node --test "js/test/*.test.mjs"` PASS. Browser: with the Task 5 layout, import a sheet with rows `MTP OM4` ports `1A,1B,1C,1D`, `2A,2B,2C`, `3A,3B` to different racks plus one `Fibra Multi Mode` row → toast "1 cabo(s) importado(s). 3 breakout(s) detectado(s) (9 linhas). 1 tipo(s) de breakout criado(s)."; Breakouts tab lists 3.

- [ ] **Step 4: Commit**

```bash
git add js/cables.js && git commit -m "feat(breakout): detect breakouts automatically on cable import"
```

---

### Task 7: Export (Cabos, Breakouts, Resumo) e PDF

**Files:**
- Modify: `js/cables.js` (`exportCablesXLSX` ~350-390), `js/pdf-report.js` (~294), `app.js` (inject `breakoutSummaryRows`, `breakoutCalc`, `breakoutLegCables` into `configureCables` and `configurePdfReport`)

**Interfaces:**
- Consumes: `breakoutSummaryRows()`, `breakoutCalc(b)` (Task 5), `breakoutLegCables()` (Task 4).

- [ ] **Step 1: Leg rows in the Cabos sheet** — in `exportCablesXLSX`, build rows from `[...state.cables, ...breakoutLegCables()]` instead of `state.cables`, and for a leg cable (`c.breakoutId`) write the breakout type name in the `Tipo` column (it already is `c.type`) and blank the length columns: replace `res=calcCable(c)` with `res=c.breakoutId?{v1:'',tray:'',v2:'',connection:'',base:'',slack:'',total:'',reachable:false,path:[]}:calcCable(c)`. The origin port label comes from the asset (`cablePortAt` already resolves `originPortId`).

- [ ] **Step 2: Breakouts sheet** — after the Cabos sheet:

```js
    const boWs=wb.addWorksheet('Breakouts');
    boWs.addRow(['Nome','Tipo','Rack Origem','U Origem','Asset Origem','Porta MTP','Tronco necessário (m)','Perna necessária (m)','Cabo (m)','Perna (m)','Preço (R$)','Pernas usadas','Destinos']);
    boWs.getRow(1).font={bold:true};
    state.breakouts.forEach(b=>{const r=breakoutCalc(b);
      boWs.addRow([b.name,b.type,rackDisplayName(state.racks.find(x=>x.id===b.origin.rack)||{}),b.origin.u,b.origin.assetName||'',b.base||'',
        r.reachable?Math.round(r.trunkNeeded*100)/100:'',r.reachable?Math.round(r.legNeeded*100)/100:'',r.pick?.m??'',r.pick?.leg??'',r.pick?.price??'',
        b.legs.filter(l=>l.destRack).length,b.legs.filter(l=>l.destRack).map(l=>`${l.lane}: ${rackDisplayName(state.racks.find(x=>x.id===l.destRack)||{})} U${l.destU}`).join('; ')]);});
    boWs.columns=[26,26,14,9,18,10,14,14,10,10,12,10,60].map(width=>({width}));
    boWs.getColumn(11).numFmt=brl.numFmt;
```

(Move `const brl=...` above the Cabos sheet so both sheets use it.)

- [ ] **Step 3: Resumo block** — after the cable rows and before the `TOTAL` row, add:

```js
    const bo=breakoutSummaryRows();
    if(bo.rows.length){
      summary.addRow([]); const h=summary.addRow(['Breakout','Cabo (m) / Perna (m)','Quantidade','Preço unit. (R$)','Subtotal (R$)']); h.font={bold:true};
      bo.rows.forEach(r=>summary.addRow([r.type,`${r.m} / ${r.leg}`,r.qty,r.price??'',r.price!=null?r.price*r.qty:'']));
    }
```

and include them in the totals: `totalValue += bo.rows.reduce((s,r)=>s+(r.price??0)*r.qty,0)`; add rows `['Breakouts', '', bo.rows.reduce((s,r)=>s+r.qty,0)]` and, if `bo.noPick`, `['Breakouts sem tamanho que sirva', bo.noPick, '']`. Keep `TOTAL` as the grand total of value.

- [ ] **Step 4: PDF** — `js/pdf-report.js:294`: after the cable table, if `breakoutSummaryRows().rows.length`, add a second `doc.autoTable` with head `[['Breakout','Cabo (m)','Perna (m)','Quantidade']]` and body `rows.map(r=>[r.type,String(r.m),String(r.leg),String(r.qty)])`, same styles. Inject `breakoutSummaryRows` through `configurePdfReport` in `app.js:36` (the import of `breakouts.js` must come before that line; if it doesn't, pass it later with a second `configurePdfReport` call is **not** supported — move the `breakouts.js` import to the import block at the top, which is where it belongs anyway).

- [ ] **Step 5: Verify** — `node --test "js/test/*.test.mjs"` PASS. Browser: export with the 3 imported breakouts (after adding sizes 10/1 and 15/1 to the type) → Cabos sheet has 9 leg rows with the breakout type; Breakouts sheet 3 rows; Resumo shows e.g. `10 m / 1 m ×1`, `15 m / 1 m ×2` and the grand total. Re-import the exported file into an empty room → 3 breakouts again.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(breakout): breakouts in cable export, purchase summary and PDF"
```

---

### Task 8: Fechamento

- [ ] **Step 1:** `node scripts/bump-version.mjs css && node scripts/system-map.mjs && node --test "js/test/*.test.mjs"` — all PASS.
- [ ] **Step 2:** Update `CLAUDE.md` "js/ holds…" list with one bullet for `breakout-model.js` (pure, tested) and one for `breakouts.js` (`configureBreakouts`).
- [ ] **Step 3:** Commit `chore: bump versions, system map and docs for breakout`.
