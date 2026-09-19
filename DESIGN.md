---
name: Stratum
description: Planejamento e gestão física de data center — fileiras, racks, calhas, cabos e inventário de assets
colors:
  console-bg: "#1c2431"
  console-panel: "#232d3c"
  console-panel-raised: "#2b3746"
  console-panel-hover: "#354254"
  console-hairline: "#45536a"
  console-hairline-strong: "#586a85"
  console-ink: "#edf2f9"
  console-muted: "#aab7cb"
  signal-blue: "#5b96ff"
  status-green: "#3ecb92"
  signal-amber: "#f2ab57"
  signal-red: "#ff8375"
  daylight-bg: "#e9eef5"
  daylight-panel: "#ffffff"
  daylight-panel-raised: "#f4f7fb"
  daylight-hairline: "#d4dce8"
  daylight-ink: "#0e1520"
  daylight-muted: "#5d6b80"
  daylight-blue: "#1f5fe0"
typography:
  display:
    fontFamily: "Titillium Web, Inter, Segoe UI, Arial, sans-serif"
    fontWeight: 700
    letterSpacing: "-0.005em"
  body:
    fontFamily: "Inter, Segoe UI, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    letterSpacing: "0.005em"
  label:
    fontFamily: "Inter, Segoe UI, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 600
  mono:
    fontFamily: "IBM Plex Mono, SFMono-Regular, Menlo, Consolas, monospace"
    fontWeight: 500
rounded:
  xs: "3px"
  sm: "5px"
  md: "8px"
  lg: "12px"
  pill: "999px"
  circle: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.signal-blue}"
    textColor: "{colors.console-bg}"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
  button-danger:
    backgroundColor: "{colors.signal-red}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
  button-quiet:
    backgroundColor: "{colors.console-panel-raised}"
    textColor: "{colors.console-ink}"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
  modal-card:
    backgroundColor: "{colors.console-panel}"
    textColor: "{colors.console-ink}"
    rounded: "{rounded.lg}"
    padding: "16px"
  row-selected:
    backgroundColor: "color-mix(in srgb, signal-blue 9%, transparent)"
    textColor: "{colors.console-ink}"
    rounded: "{rounded.sm}"
    padding: "12px 4px"
---

# Design System: Stratum

## Overview

**Creative North Star: "Console Óptico"**

Stratum não é um dashboard de analytics nem uma planilha com tema: é o **console de instrumento do data center**. A tela se comporta como um equipamento de rack — superfícies de grafite anodizado empilhadas em camadas, filete de luz claro na aresta superior de cada uma (luz vinda de cima, como num bezel de metal), réguas de 1px no lugar de sombra difusa, e um único sinal azul óptico que marca ação, seleção e rota de cabo. Vermelho, âmbar e verde continuam existindo apenas como leitura de estado (capacidade, garantia, ciclo de vida), nunca como decoração.

A leitura por trás de cada número é física: potência, U, porta, comprimento de cabo, peso. Por isso o sistema reserva o IBM Plex Mono para todo dado que É o conteúdo — o registro de mostrador de instrumento — e mantém a interface falando em Inter e Titillium Web.

O **claro é o mundo onde o app abre** — o console sob luz do dia, em neutro frio, não papel quente. O escuro é o mesmo instrumento à noite: mesma gramática de camadas, mesmo par de tokens, e deliberadamente um grafite médio-alto (não preto), para uma jornada longa não virar um buraco escuro na tela.

**Key Characteristics:**
- Claro frio (`#e9eef5` / branco) como padrão; o escuro é grafite frio (`#1c2431`), sem chegar a preto — três degraus de superfície (`panel`, `panel-raised`, `panel-hover`) fazem a profundidade antes de qualquer sombra
- Filete de luz (`--edge`, branco a 7% no escuro) na aresta superior de topbar, painéis, sheets e botões — o sinal de "material" do sistema
- A **barra óptica**: um filete de 1px do azul do sistema correndo sob a topbar, no topo dos sheets e na borda esquerda do item selecionado — o motivo assinatura, herdado do assunto (barramento/calha de cabos)
- Réguas hairline de 1px (`#45536a`) como separador primário; sombra é rasa, funcional e sempre acompanha a régua
- Um único acento de ação (`#5b96ff`) com brilho contido apenas no botão primário e no foco
- Raios contidos (3–12px), nunca pills em blocos de conteúdo
- Tabelas e linhas densas substituem cards flutuantes

## Colors

### Primary
- **Azul Óptico** (`#5b96ff` no escuro / `#1f5fe0` no claro): a cor de sinal do sistema — botão primário, seleção, foco, linha de rota no canvas, barra óptica. No escuro o texto sobre ele é tinta escura (`--on-accent: #0b1220`); no claro, branco. É o único acento de ação do sistema.

### Tertiary (estado)
- **Verde de Status** (`#3ecb92` / `#12855c`): estado "ok" e ativo (autosave salvo, garantia válida).
- **Âmbar de Sinal** (`#f2ab57` / `#a9631a`): atenção — capacidade ou garantia perto do limite, estrutura bloqueada.
- **Vermelho Sinal** (`#ff8375` / `#c0392b`): crítico — capacidade estourada, garantia vencida, exclusão.

### Neutral
- **Fundo Console** (`#1c2431` escuro / `#e9eef5` claro): fundo da aplicação e da planta.
- **Painel** (`#232d3c` / `#ffffff`): sidebars, sheets, cartões.
- **Painel Elevado** (`#2b3746` / `#f4f7fb`): botões, inputs, controles de chrome, superfícies que se apoiam sobre o painel.
- **Painel Hover** (`#354254` / `#e6ecf4`): hover de botão e de linha.
- **Régua Hairline** (`#45536a` / `#d4dce8`): toda borda de 1px do sistema. **Régua Forte** (`#586a85` / `#b6c3d5`) para hover e contornos que precisam de mais peso.
- **Filete de Luz** (`--edge`): branco a 7% no escuro, branco a 90% no claro — usado só como `inset 0 1px 0` na aresta superior.
- **Tinta** (`#edf2f9` / `#0e1520`): texto primário. **Tinta Apagada** (`#aab7cb` / `#5d6b80`): rótulos, metadados, valores secundários.
- **Chrome** (`--chrome-1`/`--chrome-2`): a rampa de duas paradas que dá "luz de cima" à topbar (mais clara em cima, mais escura embaixo).

### Named Rules

**The One Signal Rule.** O azul óptico aparece em um único lugar de destaque por tela — o botão primário da ação atual, ou o item selecionado. Ele nunca é usado para dar cor a um cabeçalho, ícone decorativo ou borda de painel.

**The State-Only Rule.** Verde, âmbar e vermelho só existem atrelados a um estado real e mensurável (capacidade, garantia, ciclo de vida, bloqueio, exclusão). Nenhum deles é usado "para dar vida" a um elemento sem dado por trás.

**The Edge Rule.** Toda superfície elevada — topbar, toolbar, sheet, menu, botão, campo — leva `inset 0 1px 0 var(--edge)`. É o que faz o sistema ler como material e não como retângulo chapado. Nenhuma superfície elevada fica sem o filete.

## Typography

**Display Font:** Titillium Web (fallback: Inter, Segoe UI, Arial)
**Body Font:** Inter (fallback: Segoe UI, Arial)
**Data/Mono Font:** IBM Plex Mono (fallback: SFMono-Regular, Menlo, Consolas)

**Character:** Titillium Web carrega a marca e os títulos reais — é uma face técnica, semi-condensada, que não confunde o app com um produto de marketing. Inter faz o trabalho pesado em densidade alta (a métrica de truncamento fixa espalhada pela interface já está calibrada nela). IBM Plex Mono é reservado ao que É o conteúdo físico: porta, watt, U, ID, IP, comprimento.

### Hierarchy
- **Display** (700, 18–22px): títulos de tela — "Entrar", nome do dashboard, "Meus projetos".
- **Headline** (700, 15px): título de modal, nome de projeto, cabeçalho de lista de cabos/fileiras.
- **Body** (400–650, 13px): botões, inputs, texto de corpo.
- **Label** (600, 11px — piso do sistema): rótulos de formulário, badges, cabeçalho de tabela.
- **Data** (500, IBM Plex Mono, 9–14px): potência, contagem de portas, IDs, valores de capacidade.

### Named Rules
**The 11px Floor Rule.** Nenhum texto funcional (rótulo, botão, célula, badge) fica abaixo de 11px. A única exceção é a grade por-U do Bayface (`--fs-bf-micro: 9px`), que tem restrição física real de altura de 1U — uma dívida do componente, não licença para reduzir texto em outro lugar.

**The Instrument Rule.** Se o valor nomeia uma quantidade física ou um identificador, ele é IBM Plex Mono. Se é uma frase, é Inter. Nunca misture os dois papéis no mesmo elemento.

## Layout

Shell fixo de topbar + duas sidebars + canvas central, sem scroll de página. A topbar tem 64px; a barra inferior da planta (zoom, camadas, exportar) 36px, centralizada sobre o canvas considerando a largura da sidebar esquerda (`--sb-left`). O minimapa é uma janela fixa de 260×150 no canto inferior direito, sempre aberta.

Breakpoints reais em 1250px, 1100px, 1000px, 900px e 800px: a sidebar direita colapsa primeiro, depois a esquerda vira gaveta deslizante. Acima de 1909px a barra inferior mostra os rótulos de camada; abaixo disso, só os ícones.

Alinhamento é à esquerda em toda a interface (listas, formulários, tabelas); a única centralização é a barra inferior sobre a planta e o estado vazio do canvas.

## Elevation & Depth

Profundidade vem de **três coisas, nesta ordem**: degrau de superfície, filete de luz, régua hairline. Sombra é o quarto recurso, nunca o primeiro, e sempre rasa.

### Shadow Vocabulary
- **Elevação de superfície** (`0 6px 16px rgba(0,0,0,.24)` no escuro): botão em hover, controles que se apoiam sobre o canvas.
- **Elevação flutuante** (`0 10px 24px rgba(0,0,0,.32)`): pílulas e barras que pairam sobre a planta (barra de zoom, busca, bloqueio, minimapa).
- **Elevação de sheet** (`--shadow`, `0 18px 40px rgba(0,0,0,.55)` escuro / `0 18px 36px rgba(15,23,40,.14)` claro): modais, confirmações, busca rápida, menus suspensos.

### Named Rules
**The No-Float Rule.** Nada que faz parte do chrome (topbar, sidebars, toolbar) flutua: chrome é fixo, em camadas planas, com filete e régua. Só flutua o que está fisicamente acima da planta (pílulas, minimapa) ou acima da tarefa (sheets).

**The Backdrop Rule.** Fundo de modal nunca é preto puro: é `#05080e` a 62% com blur de 6px e leve saturação a mais — escurece mantendo a noção de que a planta continua ali atrás.

## Shapes

Raio segue hierarquia, não gosto: `3px` (`--r-xs`) para micro-elementos e teclas, `5px` (`--r-sm`) para controles (botões, inputs, linhas de lista), `8px` (`--r-md`) para blocos e menus, `12px` (`--r-lg`) para as maiores superfícies (sheets, minimapa, sidebar-toggle arredondada de um lado). `999px`/`50%` ficam reservados a pílulas de status, à barra de zoom e a avatares.

**The Pill Rule.** Pílula é status ou controle contínuo (zoom, filtros de camada). Botão de ação, campo e bloco de conteúdo nunca são pílula.

## Components

### Buttons
- **Shape:** raio `5px` (`--r-sm`), altura 36px na topbar e 34px na toolbar.
- **Quiet (padrão):** `background: var(--panel2)`, `border: 1px solid var(--border)`, `inset 0 1px 0 var(--edge)`. Em hover sobe para `--panel3`, contorno `--border-strong` e sombra rasa.
- **Primary:** gradiente vertical curto de `color-mix(blue 88%, white)` até `blue` — superfície acesa, não decoração — com `inset 0 1px 0 rgba(255,255,255,.28)` e brilho contido (`0 4px 14px blue 26%`). Texto em `--on-accent`.
- **Danger:** mesma construção do primary em `--signal-red`, texto branco.
- **Chrome (topbar):** fundo e borda transparentes em repouso; caixa e filete só no hover.
- **Focus:** anel de 3px em `color-mix(blue 32%, transparent)`, sem `outline`.

### Chips / Badges
- Fundo tingido a ~12% da cor de estado, texto na cor de estado, borda a ~40% — pílula. Verde/âmbar/vermelho só com estado real por trás.

### Rows / Lists
- **Repouso:** transparente, separadas por `border-bottom` hairline.
- **Hover:** `--panel3` a 70%, sem mudança de raio.
- **Selecionado:** tintura azul a 9% + `inset 2px 0 0 var(--blue)` — a barra óptica na borda esquerda, nunca preenchimento cheio.

### Inputs / Fields
- Fundo `--panel2`, borda hairline, raio `5px`, sombra interna rasa (`inset 0 1px 2px`) para o campo ler como rebaixado em relação ao filete do resto.
- **Focus:** borda `--blue` + anel de 3px a 22%, mantendo a sombra interna.
- No tema claro o campo é branco sobre chrome levemente cinza.

### Modals / Sheets
- `--panel`, raio `12px`, `--shadow`, filete de luz e um filete azul de 1px no topo (a barra óptica dentro do painel). Head separado por régua hairline.

### Sheet em passos (editor de cadastro de modelo)
O editor de modelo é um sheet largo (`min(680px, 100vw - 28px)`) em dois passos numerados: cada passo é um cartão com régua hairline, cabeçalho numerado (círculo no azul do sistema, número em `--on-accent`), título em Titillium Web e dica alinhada à direita; abaixo, os campos. Campos usam ícone à esquerda via `background-image` (sem wrapper extra, mantendo o `<select>` nativo estilizado pela casa), 42px de altura, raio `8px`. O vazio da lista de portas é desenhado (borda tracejada + ícone + frase de ação), nunca só opacidade. Os dois caminhos de inclusão (conjunto sequencial e porta avulsa) são cartões irmãos separados por um divisor "OU". O rodapé tem duas ações de largura igual, 46px: `Cancelar` (quiet) e `Salvar modelo` (primary). Cadastros simples (tipo, fabricante, status) usam a mesma janela sem os passos numerados, com o rótulo "Salvar".

### Aba Propriedades (painel do cabo)
O cabeçalho da aba diz o que está selecionado — ícone, título ("Propriedades do cabo"), subtítulo curto e o nome do item como pílula monoespaçada à direita — em vez de só repetir o nome. O painel do cabo é uma sequência de passos numerados (Geral, Origem, Destino, Extras), cada um um cartão com chevron de recolher (estado lembrado fora do DOM, porque o painel é reconstruído a cada alteração). Campos estreitos usam iconografia de 13px e grade `1.15fr / 56px / 1.28fr` para Rack, U e Face. As medidas saem em linhas com tile de ícone, rótulo e valor em IBM Plex Mono; a linha de Total é a única com acento azul e o "Total arredondado" fecha o bloco. Roteamento e exclusão ficam em cartões próprios no fim, com "Excluir cabo" como botão fantasma destrutivo de largura total.

### Navigation (Topbar)
- Gradiente `--chrome-1 → --chrome-2` + filete de luz no topo + barra óptica de 1px sob a borda inferior.
- Marca à esquerda com divisor vertical; ações à direita. Desfazer/refazer é controle segmentado (36px, uma caixa, divisórias internas). Localização/sala, autosave e status de nuvem seguem a mesma linguagem de controle elevado; o status de nuvem é pílula colorida por estado.

### Bayface (Signature Component)
Visão frontal do rack, U por U, com escala tipográfica própria (`--fs-bf-micro: 9px`) abaixo do piso de 11px por restrição física de altura de 1U. A cor por tipo de asset continua vindo de uma paleta própria do componente (`bayfaceTypeColor`), intocada — ela herda apenas os tokens de superfície onde já referenciava `var(--...)`. A textura hachurada do slot vazio é uma textura local do Bayface, não uma convenção de "estado ausente" do sistema.

## Do's and Don'ts

### Do:
- **Do** dar profundidade por degrau de superfície + filete de luz antes de recorrer a sombra (The Edge Rule, The No-Float Rule).
- **Do** manter texto funcional em 11px ou mais, exceto a grade por-U do Bayface (The 11px Floor Rule).
- **Do** usar IBM Plex Mono em todo número que nomeia quantidade física ou identificador (The Instrument Rule).
- **Do** reservar o azul óptico a uma única ação/seleção de destaque por tela (The One Signal Rule).
- **Do** marcar seleção com a barra óptica de 2px à esquerda + tintura baixa, em vez de preencher linhas inteiras.
- **Do** escrever em pt-BR, sentence case, verbo ativo e o mesmo termo para a mesma coisa em todo o app (Fileira, Calha, Bayface, Asset).

### Don't:
- **Don't** usar verde, âmbar ou vermelho fora de um estado real e mensurável (The State-Only Rule).
- **Don't** empilhar gradientes decorativos, blobs radiais ou brilho neon: gradiente aqui simula luz sobre material (topbar, botão primário) e nada mais.
- **Don't** fazer chrome flutuar com sombra larga sem régua — sombra sem hairline lê como template genérico.
- **Don't** transformar bloco de conteúdo, campo ou botão de ação em pílula (The Pill Rule).
- **Don't** adicionar glifo Unicode/emoji como ícone: ícone novo é SVG desenhado, traço 2px, herdando `currentColor`.
- **Don't** reduzir contraste para "deixar moderno": se um rótulo precisa de 10px ou de cor apagada demais para ser lido, o problema é o layout, não a cor.
