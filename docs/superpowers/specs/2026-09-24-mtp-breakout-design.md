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
- Calcular **tronco e perna separadamente**, com as metragens do fornecedor.
- Contar **um item** por breakout na compra, com preço pelo tronco.
- Entender breakouts **sozinho** na importação da planilha de cabos atual, sem o usuário mudar
  nada na planilha.

## Decisões já tomadas com o usuário

| Tema | Decisão |
|---|---|
| Modelo | Breakout é uma entidade isolada, separada do cabo comum. |
| Comprimento da perna | Configurável: cada tipo de breakout tem uma lista de comprimentos de perna. |
| Preço | Só pelo tronco (tabela metragem → preço, preço opcional). |
| Portas no asset | Cada perna tem a sua porta no cadastro do equipamento: `1A`, `1B`, `1C`, `1D`. |
| Importação | Automática, pela porta: `1A`–`1D` = um breakout; `2A`–`2C` = outro, com 3 pernas usadas. |

## Premissas

- O fornecedor vende pelo **comprimento do tronco, sem contar as pernas**. Se for pelo
  comprimento total, só muda a conta do tronco (seção Cálculo).
- As pernas de um breakout têm todas o mesmo comprimento (o do produto).
- A letra final da porta é a perna: `A` = perna 1 … `H` = perna 8.

## Dados

### Catálogo: `state.cableCatalogs.breakoutTypes`

```js
{ name: 'MTP-8 → 4× LC OM4', color: '#2dd4bf', legs: 4,
  trunkLengths: [{ m: 3, price: 180 }, { m: 5 }],   // mesmo formato das metragens de cabo
  legLengths: [0.5, 1, 2, 3] }                       // metros, sem preço
```

Normalizado como os tipos de cabo (`normalizeCableLengths` para o tronco; pernas ordenadas, sem
repetição, só > 0). Projeto antigo sem a chave ganha lista vazia.

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
   Metragem do tronco = `commercialLength(tronco, type.trunkLengths)` → metragem, preço, aviso
   de "acima da maior metragem".
4. **Perna necessária** = maior distância da divisão até um destino, mais conexão, mais folga %.
   Comprimento da perna = menor valor de `type.legLengths` ≥ perna necessária.
5. Resultado: `{ reachable, trunk, trunkM, price, overTrunk, legNeeded, legM, legTooShort,
   legs: [{ lane, total, reachable }] }`.

Casos de borda:
- Todos os destinos no mesmo rack da origem: tronco ≈ 0, só perna.
- Destinos em racks diferentes com rotas que se separam cedo: perna necessária grande. Se
  nenhuma perna cadastrada alcança, `legTooShort` = true e a tela avisa: "destinos muito
  distantes para este breakout — considere tronco MTP + cassete".
- Uma perna sem rota: breakout marcado "sem rota", como o cabo comum.
- Tipo sem `legLengths`: perna necessária arredondada para cima, sem aviso.

## Importação automática (planilha de cabos atual)

Nenhuma coluna nova. Depois de ler as linhas e antes de criar cabos:

1. Para cada linha, resolve a porta de origem e a de destino no asset (como hoje).
2. Uma porta é **perna de breakout** quando o rótulo termina em número + uma letra A–H
   (`/^(.*\d)([A-H])$/i`): base `1`, perna `A`.
3. Agrupa as linhas pelo **mesmo equipamento** (rack + U + face) e **mesma base** de porta.
   Cada grupo vira um breakout; cada linha vira a perna da sua letra; o destino da linha é o
   destino da perna.
4. Se a porta com letra estiver no lado **destino**, o sistema inverte a linha antes de agrupar.
   Se as duas pontas tiverem letra, vale a origem.
5. Grupo com uma linha só também vira breakout (ex.: só `4A` usada).
6. **Tipo do breakout**: se o `Tipo` da linha já é o nome de um tipo de breakout, usa esse (é o
   que o export grava). Senão, tipo de breakout do catálogo cujo nome contém o tipo de cabo da
   linha e que tem pernas suficientes; senão cria um: `<tipo da linha> — breakout 1×N`, com N = maior
   entre 4 e a maior letra do grupo, cor do tipo de cabo, sem metragens.
7. **Nome**: o `Nome` da primeira linha do grupo.
8. Linhas sem letra na porta seguem como cabo comum, sem mudança.
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
- **Painel do breakout**: nome, tipo, origem, pernas, folga, e o resultado: tronco (calculado →
  comercial), perna (necessária → comprimento), preço, distância de cada perna, avisos.
- **Canvas**: desenha a rota de cada perna na cor do tipo. O trecho comum se sobrepõe e forma o
  tronco. Clique seleciona o breakout.
- **Catálogo**: seção "Tipos de breakout": nome, cor, nº de pernas, metragens do tronco com preço
  (mesmo editor de hoje) e comprimentos de perna.

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
  - aba **Breakouts**: uma linha por breakout: nome, tipo, origem, tronco calculado, tronco
    comercial, perna, preço, pernas usadas/total, portas.
  - aba **Resumo**: itens de breakout agrupados por tipo + tronco + perna, com quantidade, preço
    unitário e subtotal, entrando no total geral.
- **PDF**: o resumo de cabos inclui as linhas de breakout.

## Código

- `js/breakouts.js` (novo): lista, painel, adicionar, catálogo de tipos, linhas para export e
  resumo. Padrão `configureBreakouts({...})` como os outros módulos.
- `js/routing.js`: `calcBreakout` e o helper de prefixo comum.
- `js/utils.js`: `breakoutLane(label)` → `{ base, lane }` ou `null`.
- `js/cables.js`: detecção e agrupamento na importação; linhas de breakout no export e resumo.
- `app.js`: ganchos de canvas, portas ocupadas, exclusão de rack, `ROOM_KEYS`, seleção.
- `index.html` / `app.css`: abas no card Cabos, seção do catálogo.
- Rodar `node scripts/bump-version.mjs css` (módulo novo entra no import map).

## Testes

- `breakoutLane`: `1A`, `12d`, `Gi1/0/1A`, sem letra, letra além de H.
- `calcBreakout`: mesmo rack; destinos no mesmo rack remoto (tronco longo, perna curta);
  destinos em racks separados (perna longa, `legTooShort`); perna sem rota; tipo sem pernas.
- Agrupamento da importação (função pura sobre linhas já resolvidas): grupos `1A–1D`, `2A–2C`,
  `3A–3B`; porta com letra no destino; linha sem letra continua cabo comum.
- Verificação no navegador: importar uma planilha com os três grupos, conferir lista, painel,
  canvas e export.

## Fora do escopo

- Rota manual (waypoints) no breakout.
- Comprimento de perna diferente para cada destino.
- Porta MTP única no asset (`1` em vez de `1A`–`1D`).
