# Front/Rear no bayface e face do asset

Data: 2026-09-16
Status: aprovado para implementação

## Problema

O bayface hoje mostra uma única vista do rack, com o rótulo estático `FRONT`
no topo. Não há como representar equipamento montado na traseira — PDU, patch
panel e organizador de cabos, que na prática ocupam a face traseira.

A consequência é que o inventário não reflete o estado físico real, que é
justamente o critério de sucesso declarado no `PRODUCT.md`.

## Decisões tomadas

Três decisões foram fechadas antes deste documento e definem o escopo:

1. **Ocupação é por face, sem modelo de profundidade.** O asset ganha uma face
   (frente ou traseira) e cada face tem ocupação independente: sempre cabe um
   asset na frente e outro atrás da mesma U. Não existe conceito de
   "profundidade total" — dois equipamentos full-depth na mesma U em faces
   opostas são aceitos pelo sistema, embora sejam fisicamente impossíveis. É um
   tradeoff consciente em favor da simplicidade.

2. **A vista traseira mostra os assets da traseira normais e os da frente
   esmaecidos**, apenas como referência do que existe do outro lado. A vista
   frontal faz o simétrico.

3. **O campo de face começa vazio e é de preenchimento obrigatório** quando há
   rack selecionado. Não há pré-preenchimento por contexto: abrir a modal
   clicando numa U do bayface não herda a face que estava sendo vista.

## Modelo de dados

`asset.face` assume `'front'`, `'rear'` ou `null`.

`null` significa asset fora de rack (estoque) — face só faz sentido para
equipamento montado. Sempre que `rackId` for nulo, `face` também é nulo.

### Migração

`normalizeAssets()` (app.js:2265) é o único ponto de migração: asset com
`rackId` e sem `face` recebe `'front'`; asset sem `rackId` recebe `null`.

Atenção: `normalizeAssets()` reconstrói cada asset campo a campo em um literal
de objeto. Um campo que não for adicionado a esse literal é descartado a cada
chamada — e a função é chamada em praticamente todo fluxo. Adicionar `face` ali
não é opcional.

## Novo módulo: `js/occupancy.js`

A lógica de ocupação e conflito sai do `app.js` para um módulo puro, seguindo o
padrão já estabelecido por `js/geometry.js` e `js/routing.js`: sem DOM, sem
efeitos de aplicação (`toast`, `renderAll`), testável sob Node.

A motivação é concreta: a regra "mesma face conflita, faces opostas não" precisa
valer em quatro caminhos independentes (bayface, save da modal, importação XLSX,
cadastro em lote). Um call site que esqueça o filtro de face produz ocupação
inconsistente e silenciosa.

Exports:

- `assetOccupancy(asset)` — move de app.js:1712 sem alteração. Retorna
  `{start, end}` em U.
- `assetsOnFace(assets, rackId, face)` — a única resposta para "o que está nesta
  face". Filtra por rack, por face e exclui arquivados.
- `assetAtRackU(assets, rackId, u, face)` — substitui app.js:1832, agora com
  face. Devolve o asset daquela face, ou `null`. Usado pelo bayface.
- `assetsAtRackU(assets, rackId, u)` — a união das duas faces, de 0 a 2 assets.
  Usado pelo código de cabos, que conecta a uma porta e não a uma face.
- `assetOwningPort(assets, portId)` — o asset dono de uma porta, ou `null`.
  Permite rotular uma ponta de cabo sem saber a face de antemão.
- `assetConflicts(assets, asset, ignoreId)` — substitui app.js:1827. Só acusa
  conflito quando `x.face === asset.face`.
- `occupiedUnits(assets, rackId, face)` — conjunto de U ocupadas em uma face.
  Serve aos contadores do bayface e às listas de U disponíveis.

As funções recebem a lista de assets como parâmetro em vez de ler `state`
diretamente. Isso é o que as torna testáveis sem stub de estado global, e
espelha o que `helpers.mjs` já precisa fazer hoje para `geometry`/`routing`.

## Bayface

Estado novo em app.js: `bayfaceFace`, default `'front'`, vizinho do estado de
rack que já existe.

O `<span class="bayface-rack-state">FRONT</span>` (app.js:2950) vira botão. Ao
clicar, alterna `front` ⇄ `rear`, atualiza o rótulo para `FRONT`/`REAR` e
re-renderiza, preservando rack atual e scroll.

Camadas de asset:

- Assets da face atual renderizam como hoje: clicáveis, com todos os dados.
- Assets da face oposta renderizam como camada fantasma: opacidade reduzida,
  `pointer-events:none`, sem título nem tooltip de edição. Servem só para
  mostrar o que existe do outro lado.

Contadores `U ocupadas` e `U livres` e a barra de uso passam a refletir a face
visível. O contador de assets também.

A grade de U (`data-bay-add-u`) marca como ocupada apenas a face visível — uma U
com asset só na frente continua clicável na traseira.

## Formulário do asset (modal)

Novo `<select id="assetFace">` em `index.html`, com `Selecione…` / `Frente` /
`Traseira`, posicionado junto de `assetRack` e `assetUStart`.

Habilitação: reaproveita `updateAssetUFieldsState()` (app.js:2271), que já
implementa exatamente esse comportamento para `U inicial` — `disabled`, classe
`muted-field` no label e placeholder explicativo enquanto não há rack. A face
segue a mesma regra.

Validação em `saveAssetForm()` (app.js:2458): havendo rack e face vazia, aborta
com `toast` e foca o campo, no mesmo formato das validações de nome e serial que
já existem no início da função. Sem rack, grava `face: null`.

O objeto asset montado em app.js:2481 ganha o campo.

`assetConflicts` passa a vir de `js/occupancy.js` e já compara face. A checagem
existente na linha 2482 continua no mesmo lugar, mas a chamada muda de
`assetConflicts(asset, id||null)` para `assetConflicts(state.assets, asset, id||null)`,
porque o módulo recebe a lista por parâmetro em vez de ler `state`.

## Cadastro em lote

Nova coluna `Face` por linha, posicionada **antes** da coluna `U`.

A ordem importa porque a cadeia de dependência da linha muda de
`localização → rack → U` para `localização → rack → face → U`: as U disponíveis
agora dependem da face escolhida.

Mudanças:

- `bulkRowHtml()` (app.js:5150) ganha a célula com `<select data-bulk-field="face">`,
  iniciando em `<option value="">Selecione</option>` — mesmo padrão da coluna U.
- `bulkOccupiedSet(rackId, face, ignoreRow)` (app.js:5113) passa a filtrar por
  face, tanto nos assets já salvos quanto na varredura das outras linhas da
  tabela. Duas linhas no mesmo rack em faces opostas deixam de bloquear uma à
  outra.
- `bulkAvailableStarts(rackId, face, height, ignoreRow)` (app.js:5119) repassa a
  face.
- `refreshBulkRow()` (app.js:5122) lê a face da linha, desabilita a coluna `U`
  enquanto rack ou face estiverem vazios (mesmo tratamento `disabled` +
  `muted-field` já aplicado hoje quando falta rack) e recalcula as opções de U
  quando a face muda.
- `saveBulkAssets()` (app.js:5213) grava a face e rejeita linha com rack e sem
  face.
- `index.html`: novo `<col data-col="face">` e `<th>Face</th>`.
- `initBulkTableResizers()` (app.js:5169) ganha entradas para `face` nos mapas
  `defaults` e `mins`.

## Importação XLSX

Coluna `Face` opcional, aceitando `Frente` / `Traseira`. Ausente ou vazia, o
valor assumido é `Frente` — aqui o default existe deliberadamente, porque
planilha antiga não tem a coluna e falharia inteira sem ele.

`validateAssetImportRows()` (app.js:4532) monta hoje `occupiedByRack` chaveado só
por `rackId` (linhas 4536-4541); passa a ser chaveado por rack + face.
`assetImportUOptions()` (app.js:4506) tem a própria varredura de U usadas e
precisa do mesmo filtro.

## O que explicitamente não muda

Capacidade elétrica, peso e capacidade térmica continuam somando o rack inteiro,
as duas faces. Um rack tem um disjuntor e um piso só — dividir esses limites por
face seria errado. Apenas a ocupação de U é por face.

O cabo não ganha campo de face — ver a seção seguinte.

## Cabos

Esta seção corrige uma afirmação errada da primeira versão desta spec, que dizia
que cabos ficariam fora do escopo.

`assetAtRackU(rackId, u)` tem sete call sites, cinco deles no código de cabos, e
todos assumem que `(rack, U)` identifica um único asset. Com ocupação por face
isso deixa de valer: um switch na frente e um PDU atrás da mesma U tornam o
retorno ambíguo, e um cabo ligado à porta do PDU passaria a resolver para o
switch.

A solução não adiciona face ao cabo. O alvo real de uma ponta de cabo sempre foi
o **ID da porta**, que já é único no projeto inteiro — a face é uma propriedade
do asset dono da porta, e pode ser derivada. Portanto:

- `assetsAtRackU(assets, rackId, u)` devolve uma lista de 0 a 2 assets (um por
  face), substituindo o antigo retorno único.
- `assetOwningPort(assets, portId)` devolve o asset dono de uma porta. É o que
  permite rotular uma ponta de cabo sem saber a face de antemão.
- O seletor de porta de uma U passa a listar as portas dos assets das duas
  faces, identificadas pelo nome do asset.

Call sites e o que muda em cada um:

| Local | Hoje | Depois |
|---|---|---|
| `cablePortAt` (app.js:3554) | procura a porta no único asset da U | procura entre as portas de todos os assets da U |
| `cableEndpointLabel` (app.js:3555) | nome do asset vem do único asset da U | nome vem de `assetOwningPort(portId)`; sem porta escolhida e havendo um único asset na U, usa esse asset; havendo dois, usa `—` |
| `updateCableAssetNameField` (app.js:3193) | trava o campo de nome quando há asset na U | trava quando há exatamente um asset na U; havendo dois, o nome passa a seguir a porta escolhida |
| `renderCableProperties` (app.js:3218-3219) | resolve asset de origem e destino | mesma regra do item anterior, para as duas pontas |
| `processCableImportRows` (app.js:3511-3512) | casa o rótulo da porta da planilha contra as portas do asset da U | casa contra as portas dos assets das duas faces |

Cabos existentes não precisam de migração: eles já guardam `portId`, e os assets
migrados ficam todos em `front`, então toda resolução continua devolvendo o
mesmo resultado de antes.

## Testes

`js/test/occupancy.test.mjs`, seguindo o padrão dos testes existentes: apenas
`node:test` e `node:assert`, importando `helpers.mjs` primeiro.

Como `js/occupancy.js` recebe a lista de assets por parâmetro e não toca DOM nem
`localStorage`, ele não precisa dos stubs que `geometry`/`routing` exigem — mas o
import de `helpers.mjs` permanece por consistência com os outros arquivos de
teste.

Casos a cobrir:

- Dois assets na mesma U em faces opostas não conflitam.
- Dois assets na mesma U na mesma face conflitam.
- Sobreposição parcial de faixa (asset 2U contra asset 1U) na mesma face
  conflita.
- Asset arquivado não ocupa nem conflita.
- `assetAtRackU` devolve o asset da face pedida e ignora o da face oposta.
- `assetsAtRackU` devolve os dois assets quando há um em cada face, e um só
  quando a face oposta está vazia.
- `assetOwningPort` acha o dono da porta estando ele na frente ou na traseira,
  e devolve `null` para porta inexistente.
- `occupiedUnits` conta apenas a face pedida.
- Asset sem `rackId` nunca conflita.

Comando: `node --test "js/test/*.test.mjs"`.

## Arquivos tocados

| Arquivo | Mudança |
|---|---|
| `js/occupancy.js` | novo — ocupação e conflito por face |
| `js/test/occupancy.test.mjs` | novo — testes do módulo |
| `app.js` | importa o módulo; `bayfaceFace`; migração em `normalizeAssets`; face no save, no lote e na importação; resolução de ponta de cabo pelas duas faces |
| `index.html` | select de face na modal; coluna `Face` no lote |
| `app.css` | estilo da camada fantasma; botão do alternador FRONT/REAR |

## Ordem de implementação sugerida

1. `js/occupancy.js` + testes, com as funções ainda não conectadas.
2. `app.js` passa a importar o módulo e remove as versões locais, mantendo o
   comportamento atual (todos os assets em `front`).
3. Migração em `normalizeAssets` e campo na modal.
4. Bayface: alternador, camada fantasma e contadores por face.
5. Cabos: portas das duas faces nos cinco call sites.
6. Cadastro em lote.
7. Importação XLSX.

Cada etapa deixa o app funcionando; a 2 é onde a rede de testes protege a
troca de fundação.
