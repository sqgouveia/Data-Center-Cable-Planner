# Notas para agentes neste repositório

## Comece pelo mapa — e atualize no fim

[`SYSTEM-MAP.md`](SYSTEM-MAP.md) é o mapa do sistema: o que é cada arquivo, os módulos de `js/`
(com exports e dependências, em grafo), as 210 funções do `app.js` com a linha de cada uma, o
estado persistido, as seções do CSS e a tabela **"onde mexer quando…"**. Regenere depois de
mudanças estruturais:

```
node scripts/system-map.mjs
```

Fluxo obrigatório em toda mudança do sistema Stratum:

1. **Antes de editar:** consulte o mapa para achar o arquivo e a função certos (não varrer
   `app.js` por texto).
2. **Depois de editar:** rode `node scripts/system-map.mjs` e inclua `SYSTEM-MAP.md` no mesmo
   commit da mudança. Se não der para commitar, avise que o mapa ficou pendente.
3. Mudei o comportamento de algo que o mapa descreve (comando, camada de CSS, "onde mexer
   quando…")? Ajuste também o texto curado em `scripts/system-map.mjs`, senão o mapa mente.

## Comandos

```
node --test "js/test/*.test.mjs"                 # 76 testes (geometria, rota, ocupação, versões…)
node scripts/bump-version.mjs css                # sobe a versão dos módulos e do CSS (cache)
cmd /c "node --input-type=module --check < app.js"   # sintaxe do app.js (é um só arquivo grande)
```

## Regras que evitam retrabalho

- **CSS em camadas:** `macos.css` é carregado depois de `app.css`; quando os dois definem a
  mesma propriedade vale o `macos.css`. Ele também usa `:not(#\9)` para vencer especificidade —
  ao criar uma regra nova no fim do arquivo, use o mesmo truque se ela parecer não pegar.
- **Medir, não olhar:** mudanças de UI devem ser conferidas com o app no Edge headless + CDP
  (modo convidado `#btnGuestMode`, estrutura por `rowCount`/`defaultRacks`/`#btnBuildRows`,
  medidas por `getBoundingClientRect`). Os scripts ficam em `%TEMP%\stratum-measure\*`.
- **Arquivos são CRLF:** depois de editar, normalize os finais de linha.
- **Um arquivo grande:** praticamente toda a orquestração vive em `app.js`; use o mapa para
  achar a função antes de procurar por texto no arquivo inteiro.
