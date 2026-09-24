# Cabo MTP breakout — design

Data: 2026-09-24 · Branch: `Stratum-Deep`

## Problema

Um cabo MTP/MPO breakout tem uma ponta multi-fibra e N pernas (normalmente 4 LC duplex), e as
pernas costumam ir para equipamentos diferentes, às vezes em racks diferentes. Hoje o Stratum só
conhece cabo ponto a ponto, então um breakout vira N cabos soltos:

- a compra sai com N itens em vez de 1;
- cada comprimento é calculado isolado, sem considerar que as pernas saem de um tronco comum;
- nada liga as N linhas entre si.

## Objetivo

- Registrar um breakout como **um cabo**, com uma perna por destino.
- Calcular o tronco e a perna necessários e escolher, entre os **produtos cadastrados pelo
  usuário** (comprimento total + comprimento da perna), o menor que atende.
- Contar **um item** por breakout na compra, com o preço do comprimento total.
- Entender breakouts **sozinho** na importação da planilha de cabos atual, sem o usuário mudar
  nada na planilha.

## Decisões já tomadas com o usuário

| Tema | Decisão |
|---|---|
| Modelo | Breakout é uma entidade isolada, separada do cabo comum. |
| Produtos do fornecedor | O usuário cadastra cada metragem com **comprimento total e comprimento da perna** (ex.: 10 m com pernas de 1 m). O sistema não inventa a divisão tronco/perna; só escolhe entre as metragens cadastradas. |
| Preço | Por metragem cadastrada (opcional). |
| Comprimento vendido | Total = tronco + perna. Ex.: tronco 9 m + pernas 1 m = cabo de 10 m. |
| Portas no asset | Cada perna tem a sua porta no cadastro do equipamento: `1A`, `1B`, `1C`, `1D`. |
| Importação | Automática, pela porta: `1A`–`1D` = um breakout; `2A`–`2C` = outro, com 3 pernas usadas. |

## Premissas

- O fornecedor vende pelo **comprimento total** (tronco + perna), confirmado pelo usuário.
- As pernas de um breakout têm todas o mesmo comprimento (o da metragem escolhida).
- A letra final da porta é a perna: `A` = perna 1 … `H` = perna 8.

## Dados

### Catálogo: `state.cableCatalogs.breakoutTypes`

```js
{ name: 'MTP-8 → 4× LC OM4', color: '#2dd4bf', legs: 4,
  lengths: [ { m: 5,  leg: 1,   price: 180 },     // m = comprimento TOTAL vendido
             { m: 10, leg: 1 },                  // leg = comprimento das pernas desse produto
             { m: 10, leg: 2,   price: 260 } ] } // preço opcional
```

Cada metragem é um produto do fornecedor, informado pelo usuário: total, perna e preço opcional.
Pode haver o mesmo total com pernas diferentes. Normalização: ordena por total e depois perna,
remove repetição de (total, perna), exige `m > 0`, `leg > 0` e `leg < m`. Projeto antigo sem a
chave ganha lista vazia.

### Por sala: `state.breakouts` (nova chave em `ROOM_KEYS`)

```js
{ id, name, type, slack,
  origin: { rack, u, face },                 // equipamento da ponta MTP
  legs: [ { lane: 'A', originPortId,         // porta 1A no equipamento de origem
            rack, u, face, portId } ] }      // destino desta perna
```

`lane` identifica a perna; `originPortId` é a porta própria da perna no equipamento de origem
(`1A`, `1B`…). Pernas sem destino são permitidas (breakout parcialmente usado).

## Cálculo — `calcBreakout(b)` em `js/routing.js`

Função pura, sem DOM, coberta por testes em `js/test/breakout.test.mjs`.

1. Para cada perna com destino, monta um cabo temporário origem → destino e chama o motor de
   rota atual (`calcCable` / grafo de `buildRouteGraph`), com folga 0.
2. **Ponto de divisão**: último nó comum a todas as rotas (prefixo comum dos `path`).
3. **Tronco necessário** = distância da origem até a divisão, mais a folga %.
4. **Perna necessária** = maior distância da divisão até um destino, mais conexão, mais folga %.
5. **Escolha da metragem**: entre as metragens cadastradas do tipo, servem as que têm
   `leg ≥ perna necessária` e `m − leg ≥ tronco necessário`. O sistema escolhe a de **menor
   total**; em empate, a de menor perna. O tronco do produto é `m − leg`.
   Ex.: tronco necessário 8,4 m, perna necessária 0,7 m; cadastro 5 m/1 m, 10 m/1 m, 10 m/2 m →
   escolhe **10 m com pernas de 1 m** (tronco 9 m).
6. Resultado: `{ reachable, trunkNeeded, legNeeded, pick: { m, leg, price } | null, reason,
   legs: [{ lane, total, reachable }] }`. `reason` explica quando nada serve: `'leg'` (nenhuma
   perna alcança) ou `'total'` (a perna alcança, mas nenhum total é longo o bastante).

Casos de borda:
- Todos os destinos no mesmo rack da origem: tronco ≈ 0, só perna.
- Destinos em racks diferentes com rotas que se separam cedo: perna necessária grande. Se
  nenhuma perna cadastrada alcança (`reason: 'leg'`), a tela avisa: "destinos muito distantes
  para este breakout — considere tronco MTP + cassete".
- Nenhum total longo o bastante (`reason: 'total'`): aviso "acima da maior metragem cadastrada".
- Uma perna sem rota: breakout marcado "sem rota", como o cabo comum.
- Tipo sem metragens: mostra tronco e perna necessários arredondados para cima, sem produto e
  sem preço, com o aviso "cadastre as metragens deste tipo".

## Importação automática (planilha de cabos atual)

Nenhuma coluna nova. Depois de ler as linhas e antes de criar cabos:

1. Para cada linha, resolve a porta de origem e a de destino no asset (como hoje).
2. Uma linha é **perna de breakout** quando as duas condições valem:
   - o `Tipo` da linha contém "breakout" ou "MTP" (sem diferenciar maiúscula/minúscula e
     acentos) ou é o nome de um tipo de breakout do catálogo;
   - a porta termina em número + uma letra A–H (`/^(.*\d)([A-H])$/i`): base `1`, perna `A`.
   Porta com letra num cabo de tipo comum (ex.: patch panel com portas `1A`) continua cabo comum.
3. Agrupa as linhas pelo **mesmo equipamento** (rack + U + face) e **mesma base** de porta.
   Cada grupo vira um breakout; cada linha vira a perna da sua letra; o destino da linha é o
   destino da perna.
4. Se a porta com letra estiver no lado **destino**, o sistema inverte a linha antes de agrupar.
   Se as duas pontas tiverem letra, vale a origem.
5. Grupo com uma linha só também vira breakout (ex.: só `4A` usada).
6. **Tipo do breakout**: se o `Tipo` da linha já é o nome de um tipo de breakout, usa esse (é o
   que o export grava). Senão, tipo de breakout do catálogo cujo nome contém o tipo de cabo da
   linha e que tem pernas suficientes; senão cria um: `<tipo da linha> — breakout 1×N`, com N = maior
   entre 4 e a maior letra do grupo, cor do tipo de cabo, sem metragens (o usuário cadastra depois).
7. **Nome**: o `Nome` da primeira linha do grupo.
8. Linhas que não cumprem as duas condições seguem como cabo comum, sem mudança.
   Nome de tipo de breakout na coluna `Tipo` não entra na revisão de "tipos de cabo novos".
9. A mensagem final resume: "40 cabos importados, 3 breakouts detectados (9 linhas), 1 tipo de
   breakout criado".

A importação continua lendo só a primeira aba.

## Tela

- **Card Cabos**: abas **Cabos | Breakouts** (contador em cada). A lista de breakouts mostra
  nome, tipo, tronco + perna, e expande as pernas (`A → Rack 03 · U12 · SW-02 · Gi1/0/1`).
  Busca e filtro seguem o padrão da lista de cabos.
- **Adicionar breakout**: escolhe rack/U/face de origem e a base da porta (lista das bases
  com letra encontradas no asset: `1`, `2`, `3`…). As pernas aparecem uma por porta da base
  (`1A`–`1D`), cada uma com seletor de destino (rack, U, face, porta).
- **Painel do breakout**: nome, tipo, origem, pernas, folga, e o resultado: tronco necessário,
  perna necessária, **metragem escolhida** (ex.: "10 m · pernas 1 m · tronco 9 m"), preço,
  distância de cada perna, avisos.
- **Canvas**: desenha a rota de cada perna na cor do tipo. O trecho comum se sobrepõe e forma o
  tronco. Clique seleciona o breakout.
- **Catálogo**: seção "Tipos de breakout": nome, cor, nº de pernas e a lista de metragens. Cada
  linha tem três campos, **Total (m) | Perna (m) | Preço (R$)**, no estilo do editor de
  metragens de cabo (uma linha, preço opcional).

## Integração

- **Portas**: portas de breakout (as `originPortId` das pernas e as `portId` dos destinos)
  contam como ocupadas em `cablePortConflict`, `findPortConnection` (tabela de portas do asset)
  e no export de assets (portas usadas/disponíveis).
- **Rack apagado**: breakout com origem no rack é removido; perna com destino no rack fica sem
  destino, com aviso.
- **Busca global, desfazer e nuvem**: incluem `state.breakouts` (nuvem e histórico já salvam o
  `state` inteiro; troca de sala via `ROOM_KEYS`).

## Export

- **XLSX de cabos**:
  - aba **Cabos**: cada perna sai como uma linha normal, com a porta de origem própria (`1A`…) e
    o nome do tipo de breakout na coluna `Tipo`. Reimportar essa planilha reconstrói os breakouts pela regra da
    letra.
  - aba **Breakouts**: uma linha por breakout: nome, tipo, origem, tronco necessário, perna
    necessária, metragem escolhida (total, perna), preço, pernas usadas/total, portas.
  - aba **Resumo**: itens de breakout agrupados por tipo + comprimento total + perna, com quantidade, preço
    unitário e subtotal, entrando no total geral.
- **PDF**: o resumo de cabos inclui as linhas de breakout.

## Código

- `js/breakouts.js` (novo): lista, painel, adicionar, catálogo de tipos, linhas para export e
  resumo. Padrão `configureBreakouts({...})` como os outros módulos.
- `js/routing.js`: `calcBreakout` e o helper de prefixo comum.
- `js/utils.js`: `breakoutLane(label)` → `{ base, lane }` ou `null`; `normalizeBreakoutLengths`;
  `pickBreakoutLength(trunkNeeded, legNeeded, lengths)`.
- `js/cables.js`: detecção e agrupamento na importação; linhas de breakout no export e resumo.
- `app.js`: ganchos de canvas, portas ocupadas, exclusão de rack, `ROOM_KEYS`, seleção.
- `index.html` / `app.css`: abas no card Cabos, seção do catálogo.
- Rodar `node scripts/bump-version.mjs css` (módulo novo entra no import map).

## Testes

- `breakoutLane`: `1A`, `12d`, `Gi1/0/1A`, sem letra, letra além de H.
- `pickBreakoutLength`: 8,4 + 0,7 → 10 m/1 m; empate de total → menor perna; nenhuma perna
  alcança → `'leg'`; nenhum total alcança → `'total'`; lista vazia.
- `normalizeBreakoutLengths`: ordena, remove repetidos, descarta perna ≥ total.
- `calcBreakout`: mesmo rack; destinos no mesmo rack remoto (tronco longo, perna curta);
  destinos em racks separados (perna longa); perna sem rota.
- Agrupamento da importação (função pura sobre linhas já resolvidas): grupos `1A–1D`, `2A–2C`,
  `3A–3B`; porta com letra no destino; linha sem letra continua cabo comum; porta com letra e
  tipo comum continua cabo comum.
- Verificação no navegador: importar uma planilha com os três grupos, conferir lista, painel,
  canvas e export.

## Fora do escopo

- Rota manual (waypoints) no breakout.
- Comprimento de perna diferente para cada destino.
- Porta MTP única no asset (`1` em vez de `1A`–`1D`).
