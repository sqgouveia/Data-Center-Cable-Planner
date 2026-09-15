---
name: Stratum
description: Planejamento e gestão física de data center — fileiras, racks, calhas, cabos e inventário de assets
colors:
  signal-blue: "#4a86f5"
  signal-blue-ink: "#6f9bff"
  violet-relay: "#7c5cf0"
  route-cyan: "#58c2ff"
  status-green: "#22c98f"
  cable-orange: "#f2a33d"
  alert-red: "#ef4f66"
  alert-red-ink: "#ff6b80"
  ink-black: "#090c13"
  panel: "#10141f"
  panel-raised: "#161c2b"
  hairline: "#242c42"
  paper: "#eef1f8"
  graphite: "#8996ae"
  grid-line: "#1a2338"
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
  xs: "5px"
  sm: "6px"
  md: "10px"
  lg: "16px"
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
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
  button-primary-hover:
    backgroundColor: "{colors.signal-blue}"
    textColor: "#ffffff"
  button-ghost:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
  button-danger:
    backgroundColor: "{colors.alert-red}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
  modal-card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.paper}"
    rounded: "{rounded.lg}"
    padding: "16px"
  project-card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.paper}"
    rounded: "{rounded.lg}"
    padding: "18px"
---

# Design System: Stratum

## Overview

**Creative North Star: "The Patch Bay"**

Stratum é a central de conexões do próprio data center que ele documenta: uma superfície escura, densa e precisa, onde cada jack, LED e trilha de sinal tem um papel funcional, nunca decorativo. A referência não é um dashboard SaaS genérico — é o painel de um rack de patch, uma sala de operação de rede: superfícies foscas, acentos de sinal (azul, âmbar, verde) usados com parcimônia, e uma grade de blueprint sutil como lembrete de que isto é, no fundo, uma planta técnica.

O tom é preciso e técnico, discreto e sem frescura. A interface nunca tenta ser calorosa ou "amigável" — ela tenta ser correta, legível a distância e previsível em cada estado. Densidade é aceita e até celebrada (a ferramenta cabe fileiras, racks, calhas, cabos e um inventário completo de assets numa única tela), mas nunca ao custo de texto ilegível: todo rótulo funcional respeita um piso de 11px.

**Key Characteristics:**
- Fundo quase preto (dark-first) com acentos de sinal usados como exceção, não regra
- Tipografia de display (Titillium Web) reservada só para títulos reais — o corpo denso usa Inter
- Dados numéricos e de identificação (potência, portas, IDs) sempre em monoespaçada (IBM Plex Mono)
- Superfícies flutuam sobre sombra, nunca sobre contorno
- Cor sempre carrega significado de estado (verde=ok, âmbar=atenção, vermelho=crítico) — nunca é só decoração

## Colors

A paleta é quase monocromática (azul-marinho quase preto) com acentos de sinal reservados a estado e ação — a cor rara é a cor que importa.

### Primary
- **Azul Sinal** (`#4a86f5` / ink de texto `#6f9bff`): a cor de ação do sistema — botões primários, foco, seleção, links. Referência direta ao cabo de rede/patch cable azul. Usado em no máximo um elemento de destaque por tela.

### Secondary
- **Relé Violeta** (`#7c5cf0`): parceiro de gradiente do Azul Sinal em botões primários e no filete superior da topbar — nunca usado sozinho como cor de texto ou ícone.
- **Ciano de Rota** (`#58c2ff`): exclusivo do canvas — a linha de roteamento de cabo (`.route-line`) e o preenchimento de seleção de rack. Nunca aparece fora do desenho da planta.

### Tertiary
- **Âmbar de Calha** (`#f2a33d`): cor física da calha de cabeamento no desenho da planta, e o estado "atenção" (potência/garantia perto do limite).
- **Verde de Status** (`#22c98f`): LED "ligado"/ocupado no rack, badges de asset ativo, alerta de capacidade baixa.
- **Vermelho de Alerta** (`#ef4f66` / ink de texto `#ff6b80`): estado crítico — capacidade estourada, garantia vencida, exclusão. O ink de texto mais claro existe especificamente para manter 4.5:1 quando o vermelho aparece como texto sobre um fundo já tingido de vermelho (badges, banners).

### Neutral
- **Preto-Tinta** (`#090c13`): fundo da aplicação.
- **Painel** (`#10141f`): superfície base de cards, modais, sidebars.
- **Painel Elevado** (`#161c2b`): superfície secundária — inputs, badges, linhas de tabela alternadas.
- **Linha Capilar** (`#242c42`): toda borda de 1px do sistema.
- **Papel** (`#eef1f8`): texto primário.
- **Grafite** (`#8996ae`): texto secundário/muted — rótulos, metadados, texto de apoio.
- **Linha de Grade** (`#1a2338`): grade de fundo do canvas e do overlay de blueprint na tela de login.

### Named Rules
**The Rare Signal Rule.** Azul Sinal aparece em no máximo um lugar de destaque por tela — botão primário da ação atual, ou o item selecionado. Nunca dois elementos de mesmo peso visual competindo pela mesma cor.

**The Status Color Rule.** Verde, âmbar e vermelho nunca são estéticos — cada um corresponde a um estado real e mensurável (capacidade, garantia, ciclo de vida). Não introduza essas cores para "dar vida" a um elemento sem estado por trás.

## Typography

**Display Font:** Titillium Web (fallback: Inter, Segoe UI, Arial)
**Body Font:** Inter (fallback: Segoe UI, Arial)
**Label/Mono Font:** IBM Plex Mono (fallback: SFMono-Regular, Menlo, Consolas)

**Character:** Titillium Web carrega a identidade nos títulos reais (marca, cabeçalhos de modal, telas de auth/dashboard) — um traço técnico, quase de engenharia, sem ser frio. Inter faz todo o trabalho pesado do corpo denso da ferramenta porque sua métrica já estava calibrada nos truncamentos (`text-overflow:ellipsis`) espalhados pela interface; trocar a fonte de corpo teria efeito cascata sobre dezenas de larguras fixas. IBM Plex Mono entra sempre que o número É o conteúdo — porta, watt, ID.

### Hierarchy
- **Display** (700, 18–22px): títulos de tela — "Entrar", nome do dashboard, marca Stratum na topbar/auth.
- **Headline** (700, 15px): título de modal (`.modal-head h3`), nome de projeto no card.
- **Body** (400–650, 13px): botões, inputs, texto de corpo, mensagens de auth.
- **Label** (600, 11px — piso do sistema): rótulos de formulário, badges, cabeçalho de tabela, contadores. Nunca abaixo de 11px fora do grid por-U do Bayface.
- **Data** (500, IBM Plex Mono, 11–14px): potência, contagem de portas, IDs de asset, valores de capacidade.

### Named Rules
**The 11px Floor Rule.** Nenhum texto funcional (rótulo, botão, célula de tabela, badge) fica abaixo de 11px. A única exceção documentada é a grade por-U do Bayface (`--fs-bf-micro: 9px`), que tem uma restrição física real de altura de linha — 1U de rack não cabe 11px de texto sem quebrar a proporção do desenho.

## Layout

A aplicação é um shell fixo de topbar + duas sidebars + canvas central, sem scroll de página — cada região rola independentemente. Densidade é alta por design: o painel esquerdo ("Ambiente") empilha dezenas de campos numéricos sem seções colapsáveis, porque o usuário (equipe interna de infra) configura isso raramente e quer tudo visível de uma vez.

Breakpoints reais em 1250px, 1100px, 1000px, 900px e 800px colapsam a sidebar direita primeiro, depois a esquerda vira gaveta deslizante — a ordem de prioridade é sempre canvas > sidebar esquerda > sidebar direita, porque a planta física é a informação que nunca pode desaparecer.

## Elevation & Depth

O sistema usa sombra pura para elevação — nenhuma superfície flutuante (modal, card de projeto, botão circular de canvas) tem borda visível em repouso. A borda existia antes e foi removida deliberadamente nesta sessão porque a combinação borda+sombra-larga é a assinatura mais reconhecível de UI gerada por IA.

### Shadow Vocabulary
- **Elevação padrão** (`--shadow`, `0 8px 20px rgba(2,5,12,.4)` no escuro / `0 6px 16px rgba(30,48,80,.14)` no claro): usada por `.project-card` e pelos botões circulares flutuantes do canvas.
- **Elevação de modal** (`0 16px 40px rgba(2,5,12,.45)`): `.modal-card`, para conteúdo que interrompe a tarefa.
- **Elevação de auth** (`0 20px 50px rgba(2,5,12,.45)`): `.auth-card`, a superfície mais isolada da aplicação.
- **Elevação de menu de contexto** (`0 10px 26px rgba(2,5,12,.4)`): `.project-menu-panel`.
- **Anel de foco/hover** (`0 0 0 1px var(--blue) inset` ou `color-mix(...) inset`): substitui completamente a borda como sinal de interação — é um anel interno, não uma borda externa.

### Named Rules
**The Floating Panel Rule.** Toda superfície que paira sobre o conteúdo (modal, card, botão circular de canvas, menu de contexto) usa sombra para se definir, nunca borda. Quando um estado de interação (hover, seleção) precisa de um contorno, ele é um anel via `box-shadow: ... inset`, não `border-color`.

## Shapes

Raios pequenos e consistentes: `5px`/`6px` para controles (botões, inputs), `10px` para blocos de conteúdo (seções de porta, badges de card), `16px`/`20px` para superfícies grandes (modal, card, auth-card), `50%`/`999px` para tudo circular ou pílula (LEDs, badges de status, botões flutuantes do canvas). Nenhuma forma geométrica decorativa além disso — o desenho do rack/calha/cabo no canvas SVG é a única geometria "livre" do sistema, e ali ela é literal (representa a planta física real), não estilística.

## Components

### Buttons
- **Shape:** raio de 6px (`--r-sm`), pílula só em contadores/badges.
- **Primary:** gradiente `var(--blue) → var(--blue2)`, texto branco, sombra neutra `0 6px 16px rgba(2,5,12,.35)` (nunca colorida).
- **Ghost:** fundo `panel-raised` semi-transparente, borda `hairline` — o botão padrão da topbar/toolbar.
- **Danger:** gradiente `var(--red) → #7a1220`, mesma regra de sombra neutra do Primary.
- **Hover / Focus:** `translateY(-1px)` + anel `inset` na cor do botão — nunca glow externo colorido.
- **Sensação:** sólida e direta ao ponto — feedback imediato, sem hesitação, sem enfeite.

### Chips / Badges
- **Style:** fundo tingido a ~10-16% da cor de estado sobre `panel`/`panel-raised`, texto na variante `-ink` da mesma cor (nunca a cor base direto, pra manter contraste).
- **State:** `level-soon`/`level-expired` (ciclo de vida), `power-mid`/`power-high` (capacidade), sempre com border tingida na mesma cor a 45%.

### Cards / Containers
- **Corner Style:** 16px (`--r-lg`).
- **Background:** gradiente sutil `panel` para `panel+2% branco` no topo.
- **Shadow Strategy:** ver Elevation & Depth — sombra apenas, sem borda em repouso; hover em `.project-card` acende uma barra de 2px azul→violeta no topo em vez de mudar a borda.
- **Internal Padding:** 16–18px.

### Inputs / Fields
- **Style:** fundo `panel-raised`, borda `hairline` de 1px, raio 6px.
- **Focus:** borda muda para `--blue` + anel `box-shadow` de 3px na mesma cor a 16% — nunca glow largo.
- **Error:** borda e texto em `--red` (não a variante `-ink`, já que inputs não têm fundo tingido).

### Navigation (Topbar)
- **Style:** altura fixa 64px, marca à esquerda (Titillium Web), ações à direita em `.btn.ghost` por padrão, com um filete inferior de gradiente azul→violeta a 60% de opacidade como única assinatura decorativa da topbar.

### Bayface (Signature Component)
Visão frontal do rack, U por U — o componente mais distintivo do sistema. Cada U é uma célula de grade com escala tipográfica própria (`--fs-bf-micro: 9px`), deliberadamente menor que o piso de 11px do resto do app porque a proporção física de 1U não permite mais que isso sem distorcer o desenho. Cor por tipo de asset vem de uma paleta própria (`bayfaceTypeColor`), não da paleta de estado do resto do sistema.

## Do's and Don'ts

### Do:
- **Do** usar sombra pura para elevar superfícies flutuantes (The Floating Panel Rule).
- **Do** manter texto funcional em 11px ou mais, exceto na grade por-U do Bayface (The 11px Floor Rule).
- **Do** reservar Azul Sinal para uma única ação/seleção de destaque por tela (The Rare Signal Rule).
- **Do** usar IBM Plex Mono sempre que o conteúdo for um número identificador (porta, watt, ID, IP).
- **Do** tingir o texto de estado (vermelho/azul) com a variante `-ink` quando ele sentar sobre um fundo já tingido da mesma cor.

### Don't:
- **Don't** combinar borda de 1px com sombra larga e difusa no mesmo elemento — é a assinatura mais reconhecível de UI gerada por IA.
- **Don't** usar `box-shadow` colorido (glow) em botões ou ícones — sombra de elevação é sempre neutra (`rgba(2,5,12,...)`).
- **Don't** introduzir verde/âmbar/vermelho decorativamente — essas cores sempre representam um estado real e mensurável.
- **Don't** replicar o visual genérico de dashboard SaaS (cards brancos flutuantes, gráfico de pizza decorativo, hero com gradiente roxo-azul) — a referência é um patch bay, não um produto de analytics.
- **Don't** adicionar um novo glifo Unicode/emoji como ícone. Os que já existem (➕, ✓, ↪) são dívida herdada, não o padrão — ícones novos devem ser SVG desenhado, mesmo traço/peso dos existentes.
