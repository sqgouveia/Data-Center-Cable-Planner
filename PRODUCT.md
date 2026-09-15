# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Equipes internas de TI/infraestrutura que administram o(s) próprio(s) data center(s) da organização — uso operacional contínuo, não um produto vendido a múltiplos clientes externos. O usuário típico cadastra e mantém a estrutura física (fileiras, racks, calhas, cabos) e o inventário de equipamentos (assets) ao longo do tempo, não só numa configuração inicial.

## Product Purpose

Stratum é uma ferramenta de planejamento e documentação física de data center: define a planta (fileiras e racks), desenha o caminho físico das calhas de cabeamento, cadastra cabos com roteamento e comprimento calculados automaticamente, e mantém um inventário de assets (equipamentos) com posição em U, portas, potência, peso e ciclo de vida (garantia/EOL). Sucesso = a planta e o inventário refletem com precisão o estado físico real do data center, e permanecem fáceis de manter conforme mudam.

## Positioning

Simplicidade sem infraestrutura pesada: roda como site estático (HTML/CSS/JS puro, sem framework, sem build step, sem backend próprio além do Supabase para auth/sync), mais leve e direto que um DCIM enterprise (NetBox, Device42), e mais estruturado/visual que manter tudo em planilha. Não compete em profundidade de rede/DCIM completo — compete em ser rápido de adotar e usar sem infraestrutura própria.

## Operating Context

- Fluxo típico: cadastrar localização (data center) → sala → fileiras/racks → calhas → assets (equipamentos) → cabos (origem/destino com rack, U e porta) → gerar relatório PDF ou exportar planilha quando necessário.
- Interface e conteúdo em português (pt-BR).
- Dois modos de uso: autenticado com sincronização em nuvem (Supabase), ou "convidado" 100% local (localStorage, sem nuvem) — os dois precisam continuar funcionando.
- Suporta múltiplas salas por localização e múltiplas localizações (multi-data-center).
- Import/export de cabos e assets via Excel (XLSX), com preview e validação antes de confirmar.

## Capabilities and Constraints

- Sem build step e sem framework — HTML/CSS/JS servido diretamente (GitHub Pages). Isso deve continuar assim: qualquer trabalho futuro não deve introduzir bundler, React/Vue/etc.
- Backend fixo: Supabase (auth + Postgres) para as contas autenticadas — tabelas `projects` (snapshot do projeto) e `asset_change_log` (auditoria de mudanças em assets). Não trocar de provedor sem discutir antes.
- Modo convidado (sem login, sem nuvem, tudo em localStorage) é uma capacidade obrigatória, não um modo secundário descartável.
- Bibliotecas de terceiros carregadas via CDN: SheetJS (XLSX), ExcelJS, jsPDF (carregado sob demanda só quando o relatório PDF é gerado).
- Roteamento de cabos calcula o caminho mais curto através do grafo de calhas (trays) conectadas — não é uma linha reta arbitrária.
- Capacidades opcionais por rack (elétrica em W, carga do piso em kg) e por sala (refrigeração em W) geram alertas quando próximas do limite; ciclo de vida de asset (garantia, EOL) também gera alertas.
- Histórico de undo/redo e autosave na nuvem (quando autenticado) já existem e devem ser preservados.

## Brand Commitments

- Nome do produto: **Stratum**.
- Tagline existente: "Planejamento e gestão de data center".
- Logo já existe (`logo.png`) — usado como marca em todas as telas (auth, dashboard, topbar).

## Evidence on Hand

Nenhuma evidência externa (depoimento, case, cliente nomeado, número de uso real) está registrada no projeto — não inventar nenhuma dessas coisas em trabalho futuro. O conteúdo funcional em si (telas, textos de ajuda, glossário em `#helpModal`) é real e deve ser tratado como fonte de verdade para terminologia (ex.: "Fileira", "Calha", "Bayface", "Asset").

## Product Principles

1. Zero infraestrutura própria além do Supabase — continua deployável como site estático.
2. O modo convidado (sem nuvem) é cidadão de primeira classe, não um fallback degradado.
3. Precisão física em primeiro lugar: comprimento de cabo, capacidade elétrica/peso/térmica e posição de U devem refletir a realidade, não estimativas grosseiras.
4. Terminologia em português consistente com o glossário já existente na Ajuda do sistema.
5. Ferramenta operacional (uso contínuo por equipe interna), não uma landing page ou produto de aquisição — prioriza eficiência de tarefa sobre persuasão.
