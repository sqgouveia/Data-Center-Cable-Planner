---
name: Stratum
description: Planejamento e gestão física de data center — fileiras, racks, calhas, cabos e inventário de assets
colors:
  paper: "#f6f4ee"
  panel: "#fbfaf5"
  panel-raised: "#efebe0"
  hairline: "#c9c2b0"
  ink: "#15181d"
  muted: "#6b6656"
  stamp-blue: "#1d4ed8"
  status-green: "#2f7d4f"
  spec-amber: "#a8650f"
  stamp-red: "#8a3324"
  blueprint-bg: "#1c2430"
  blueprint-panel: "#212a37"
  blueprint-panel-raised: "#293342"
  blueprint-hairline: "#455063"
  blueprint-ink: "#eef0ea"
  blueprint-muted: "#a8ad9c"
  blueprint-blue: "#8db6ff"
  blueprint-green: "#6fbf8f"
  blueprint-amber: "#e0a54f"
  blueprint-red: "#ef9683"
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
  xs: "2px"
  sm: "3px"
  md: "4px"
  lg: "6px"
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
    backgroundColor: "{colors.stamp-blue}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
  button-danger:
    backgroundColor: "{colors.stamp-red}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    padding: "7px 10px"
  modal-card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "16px"
  project-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.xs}"
    padding: "12px 4px"
---

# Design System: Stratum

## Overview

**Creative North Star: "Datasheet de Componente"**

Stratum lê como a própria folha de especificação do data center que documenta — um documento impresso, preciso e permanente, não um dashboard SaaS de analytics nem um terminal hacker retrô escuro. O mundo padrão é papel não-couché quente e tinta quase-preta, com réguas de tabela em hairline no lugar de cards flutuantes; a cor rara — vermelho-tijolo "carimbo" — é reservada estritamente a estado crítico. Uma variante escura ("blueprint negative") existe como segundo tema, não como o mundo primário: ela inverte o mesmo sistema de tokens para uma leitura de planta técnica sob luz de instrumento, e não é um retorno ao antigo tema "Patch Bay" que este arquivo documentava antes.

O tom é o de um instrumento de medição confiável, não de um produto que tenta ser caloroso. Densidade é alta e aceita — tabelas de especificação substituem cards — mas nunca ao custo de legibilidade: o piso de 11px para texto funcional continua valendo, e cor continua carregando apenas significado de estado real, nunca decoração.

**Key Characteristics:**
- Papel quente (`#f6f4ee`) como fundo padrão; a variante escura é um segundo tema explícito, não o padrão
- Réguas de tabela em hairline (`#c9c2b0` claro / `#455063` escuro) substituem sombra como o principal sinal de separação de superfície
- Um único acento "carimbo" (`#8a3324` claro) reservado a estado crítico — nunca usado para ação primária comum
- Botões primário/perigo são preenchimentos chapados (flat fill), não gradiente
- Tabelas de especificação densas (linhas com régua inferior) substituem cards flutuantes de projeto
- Raios de canto pequenos e contidos (2–6px), não os 5–16px do mundo anterior

## Colors

A paleta é quase monocromática sobre papel (ou sobre azul-ardósia escuro na variante blueprint), com um único acento de estado crítico e dois acentos de status herdados (verde/âmbar) usados com a mesma parcimônia de antes.

### Primary
- **Azul Carimbo** (`#1d4ed8` no tema claro / `#8db6ff` no blueprint escuro): a cor de ação do sistema — botão primário, seleção, foco, linha de rota no canvas. Usada em preenchimento chapado (flat), sem gradiente.

### Tertiary
- **Verde de Status** (`#2f7d4f` claro / `#6fbf8f` escuro): estado "ok"/ativo — mesmo papel semântico do mundo anterior, cor renumerada para o novo par claro/escuro.
- **Âmbar de Especificação** (`#a8650f` claro / `#e0a54f` escuro): estado de atenção (capacidade/garantia perto do limite).
- **Vermelho Carimbo** (`#8a3324` claro / `#ef9683` escuro): o único acento reservado a estado crítico real — capacidade estourada, garantia vencida, exclusão. Não é usado para ênfase decorativa nem para botões que não sejam destrutivos.

### Neutral
- **Papel** (`#f6f4ee`): fundo da aplicação no tema claro (padrão).
- **Painel** (`#fbfaf5`): superfície de cards/modais/sidebars no tema claro.
- **Painel Elevado** (`#efebe0`): inputs, badges, linhas alternadas no tema claro.
- **Régua Hairline** (`#c9c2b0` claro / `#455063` escuro): toda borda/régua de 1px do sistema — o principal divisor visual, substituindo sombra difusa.
- **Tinta** (`#15181d` claro / `#eef0ea` escuro): texto primário.
- **Tinta Apagada** (`#6b6656` claro / `#a8ad9c` escuro): texto secundário/muted — rótulos, metadados.
- **Fundo Blueprint** (`#1c2430`) / **Painel Blueprint** (`#212a37` / `#293342`): a variante escura — não reutiliza a paleta navy-quase-preta do antigo tema Patch Bay (`#090c13`/`#10141f`); é um par de tokens novo, mais azul-ardósia.

### Named Rules
**The Stamp Rule.** O vermelho-carimbo (`#8a3324`/`#ef9683`) só aparece atrelado a um estado crítico real e mensurável (capacidade estourada, garantia vencida, exclusão). Nunca é usado como cor de botão comum ou destaque decorativo.

**The Rare Signal Rule.** Azul Carimbo aparece em no máximo um lugar de destaque por tela — botão primário da ação atual, ou o item selecionado.

**The Status Color Rule.** Verde e âmbar nunca são estéticos — cada um corresponde a um estado real e mensurável (capacidade, garantia, ciclo de vida). Não introduza essas cores para "dar vida" a um elemento sem estado por trás.

## Typography

**Display Font:** Titillium Web (fallback: Inter, Segoe UI, Arial)
**Body Font:** Inter (fallback: Segoe UI, Arial)
**Label/Mono Font:** IBM Plex Mono (fallback: SFMono-Regular, Menlo, Consolas)

**Character:** Titillium Web carrega os títulos reais — marca, cabeçalhos de modal, telas de auth/dashboard. Inter faz o trabalho pesado do corpo denso (a métrica já estava calibrada nos truncamentos fixos espalhados pela interface, herdado do mundo anterior e preservado). IBM Plex Mono entra sempre que o número É o conteúdo — porta, watt, U, ID — funcionando como o registro "tipo mostrador de instrumento" para leituras físicas que a direção pede; nenhuma propriedade CSS nova de `font-variant-numeric` foi introduzida para isso — o efeito tabular vem da própria natureza monoespaçada da fonte já em uso.

### Hierarchy
- **Display** (700, 18–22px): títulos de tela — "Entrar", nome do dashboard, marca Stratum.
- **Headline** (700, 15px): título de modal (`.modal-head h3`), nome de projeto na linha de especificação.
- **Body** (400–650, 13px): botões, inputs, texto de corpo, mensagens de auth.
- **Label** (600, 11px — piso do sistema): rótulos de formulário, badges, cabeçalho de tabela, contadores.
- **Data** (500, IBM Plex Mono, 9–14px): potência, contagem de portas, IDs de asset, valores de capacidade.

### Named Rules
**The 11px Floor Rule.** Nenhum texto funcional (rótulo, botão, célula de tabela, badge) fica abaixo de 11px. A única exceção documentada continua sendo a grade por-U do Bayface (`--fs-bf-micro: 9px`), que tem uma restrição física real de altura de linha — 1U de rack não cabe 11px de texto sem quebrar a proporção do desenho. Esta exceção é uma dívida física do componente, não uma licença para reduzir texto em qualquer outro lugar.

## Layout

A aplicação continua um shell fixo de topbar + duas sidebars + canvas central, sem scroll de página. Breakpoints reais em 1250px, 1100px, 1000px, 900px e 800px colapsam a sidebar direita primeiro, depois a esquerda vira gaveta deslizante — não alterados nesta sessão.

## Elevation & Depth

O sistema deste mundo usa **hairline (régua de 1px) como o sinal primário de separação de superfície**, não sombra pura — a inversão deliberada da regra do mundo anterior. `.auth-card` volta a usar `border: 1px solid var(--border)` junto de uma sombra rasa; `.project-card` (agora uma linha de tabela) usa `border-bottom: 1px solid var(--border)` e nenhuma sombra em repouso. Onde sombra ainda aparece (`.modal-card`, `.canvas-tool-toggle`), ela é rasa e funcional (elevar acima do canvas), não o dispositivo de flutuação livre-de-borda do mundo anterior.

### Shadow Vocabulary
- **Elevação padrão** (`--shadow`, `0 8px 20px rgba(30,26,15,.1)` no claro / `0 8px 20px rgba(6,9,14,.4)` no blueprint escuro): usada por `.auth-card` e pelo botão flutuante do canvas, em conjunto com hairline, não no lugar dele.
- **Elevação de modal** (`0 16px 40px rgba(2,5,12,.45)`): `.modal-card`.

### Named Rules
**The Hairline Rule.** Toda separação de superfície no dashboard e nas listas (linha de projeto, linhas de tabela de especificação, cartão de auth) é feita por régua de 1px na cor hairline, não por sombra larga e difusa. Sombra, quando usada, é rasa e acompanha a régua — nunca a substitui.

## Shapes

Raios pequenos e contidos, tensionados para baixo em relação ao mundo anterior: `2px` (`--r-xs`) para elementos de linha/registro, `3px` (`--r-sm`) para controles (botões, inputs), `4px` (`--r-md`) para blocos de conteúdo, `6px` (`--r-lg`) para modais e o cartão de auth. Não há mais o degrau de 16px/20px do mundo anterior — a maior superfície do sistema hoje usa 6px. `999px`/`50%` seguem reservados a elementos circulares/pílula (badges de status, botão flutuante do canvas).

## Components

### Buttons
- **Shape:** raio de 3px (`--r-sm`) no botão de formulário padrão; a topbar usa 4px.
- **Primary:** `background: var(--blue)` chapado, `box-shadow: none` — preenchimento sólido, não gradiente. (Nota de drift: alguns contextos legados — `.topbar .actions>.btn.primary`, `.btn.primary:hover` global, `.row-card:hover` — ainda carregam `box-shadow` com valores de sombra colorida/difusa do mundo anterior não varridos nesta sessão; ver linha de defeitos no relatório.)
- **Danger:** `background: var(--red)` chapado, `box-shadow: none`, mesmo padrão do Primary.
- **Ghost:** fundo transparente, texto `muted`, sem borda em repouso — usado na topbar/toolbar.
- **Hover / Focus:** escurece o preenchimento (`color-mix` em direção a preto) em vez de mudar sombra; ghost ganha `background: panel2` + borda hairline no hover.

### Chips / Badges
- **Style:** fundo tingido a baixa opacidade da cor de estado, texto na cor de estado, borda tingida — padrão herdado e preservado.

### Cards / Containers (project spec-row)
- **Corner Style:** `0` — a linha de projeto do dashboard não é mais um card com canto arredondado; é uma linha de tabela.
- **Background:** transparente em repouso; tingido levemente de azul no hover (`color-mix(var(--blue) 6%, transparent)`).
- **Shadow Strategy:** nenhuma — ver Elevation & Depth. A separação é a régua inferior (`border-bottom: 1px solid var(--border)`).
- **Border:** `border-bottom: 1px solid var(--border)` apenas; uma barra vertical de 2px na cor azul acende à esquerda no hover (substitui a antiga barra de topo azul→violeta em gradiente — hoje é cor sólida única, sem parceiro violeta).
- **Internal Padding:** `12px 4px`, layout em linha (`display:flex`) em vez de bloco de card.
- **Icon:** o ícone de pasta em emoji foi substituído por um SVG de documento desenhado, coerente com o tema "datasheet".

### Inputs / Fields
- **Style:** fundo `panel-raised`, borda `hairline` de 1px, raio 3px.
- **Focus:** borda muda para `--blue` + anel `box-shadow` de 3px na mesma cor a 16%.

### Navigation (Topbar)
- **Style:** ações padrão em `.btn.ghost` (fundo transparente), botão primário em preenchimento chapado azul. As três gradiente-glows decorativos do mundo anterior (blobs radiais da tela de auth, filete de gradiente da topbar, barra de gradiente do hover do card) foram removidos nesta sessão em favor do sistema hairline/token.

### Bayface (Signature Component)
Visão frontal do rack, U por U, com escala tipográfica própria (`--fs-bf-micro: 9px`) abaixo do piso de 11px por restrição física real de altura de 1U — inalterado nesta sessão. A cor por tipo de asset continua vindo de uma paleta própria (`bayfaceTypeColor`), estruturalmente intocada; ela só herda os novos tokens de superfície onde já referenciava `var(--...)` (fundo do rack, réguas, trilho). A textura hachurada fina do slot vazio do Bayface (`repeating-linear-gradient`) já existia antes desta sessão como uma textura local do componente — não é um novo sistema de "estado ausente/desabilitado" aplicado ao resto do app, e não deve ser lido como tal.

## Do's and Don'ts

### Do:
- **Do** usar régua hairline de 1px como separador primário de superfície — cards de lista, linhas de tabela, cartão de auth (The Hairline Rule).
- **Do** manter texto funcional em 11px ou mais, exceto na grade por-U do Bayface (The 11px Floor Rule).
- **Do** reservar o vermelho-carimbo estritamente a estado crítico real e mensurável (The Stamp Rule).
- **Do** reservar Azul Carimbo para uma única ação/seleção de destaque por tela (The Rare Signal Rule).
- **Do** usar IBM Plex Mono sempre que o conteúdo for um número identificador ou leitura física (porta, watt, U, ID).
- **Do** usar preenchimento chapado (flat fill), não gradiente, em botões primário e de perigo.

### Don't:
- **Don't** introduzir verde/âmbar/vermelho decorativamente — essas cores sempre representam um estado real e mensurável.
- **Don't** reintroduzir gradiente em botão primário/perigo ou em barra decorativa de hover — este mundo é chapado, não o "Patch Bay" de gradiente azul→violeta que este arquivo documentava antes.
- **Don't** tratar a régua hairline do slot vazio do Bayface como uma regra de sistema para "estado ausente/desabilitado" em outras superfícies — é uma textura local do componente, não canonizada como convenção geral.
- **Don't** adicionar um novo glifo Unicode/emoji como ícone. Os que restam no app (☾/☀ do toggle de tema, ⋮, ＋, ↪ — 9 ocorrências não varridas nesta sessão) são dívida herdada, não o padrão — ícones novos são SVG desenhado, como o ícone de documento já usado na linha de projeto.
- **Don't** assumir que o tema escuro ("blueprint negative") é uma pele opcional secundária esteticamente livre — ele reutiliza o mesmo par de tokens hairline/flat deste sistema; não é licença para reintroduzir sombra-sem-borda ou gradiente só porque está no modo escuro.
