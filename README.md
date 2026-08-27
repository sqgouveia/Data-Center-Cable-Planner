# Data Center Cable Planner — Manual Route Test

Versão de teste baseada na UI Redesign v1 sem legenda e com modo de roteamento.

## Novidade
- Modo Automático: a rota é calculada pelo sistema; o botão manual de cálculo foi removido.
- Modo Manual: clique em “Adicionar rack à rota”, depois clique nos racks intermediários desejados.
- Cada rack intermediário só é aceito quando existe caminho pelas calhas a partir do último rack escolhido.
- A rota manual final é validada trecho a trecho e desenhada sobre a infraestrutura existente.
- É possível remover os racks intermediários ou limpar a rota.

A lógica de racks, calhas, cabos, seleção, pan/zoom, sidebar, Supabase e demais recursos existentes foi preservada.
