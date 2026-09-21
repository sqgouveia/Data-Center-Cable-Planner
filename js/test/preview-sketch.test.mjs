// A prévia de projeto (tela de projetos) desenha a planta de uma sala que NÃO está aberta: ela
// empresta o estado, chama geometry()/rackRect() e devolve o estado. Este teste guarda essa
// suposição — se a geometria passar a exigir mais estado, o desenho cairia no esquemático.
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetState, buildTwoRackScenario } from './helpers.mjs';
import { state } from '../state.js';
import { geometry, rackRect, trayPointForRowIndex } from '../geometry.js';

test('geometry() e rackRect() desenham uma sala emprestada (prévia de projeto)', () => {
  resetState(state);
  buildTwoRackScenario(state);
  // Estado "aberto" que a prévia não pode mexer.
  const aberto = { rows: state.rows, racks: state.racks, trays: state.trays };

  // Sala de um projeto na nuvem: rows/racks/trays crus, como vêm do banco.
  const sala = {
    rows: [{ id: 'r1', name: '', rackCount: 3, gap: 0, depth: 1.2 }],
    racks: [0, 1, 2].map(i => ({ id: 'k' + i, rowId: 'r1', index: i, name: String(i + 1), units: 48, width: 0.6, depth: 1.2 })),
    trays: [{ id: 't1', x1: 40, y1: 300, x2: 240, y2: 300 }],
  };
  state.rows = sala.rows; state.racks = sala.racks; state.trays = sala.trays;
  const g = geometry();
  const retangulos = state.racks.map(r => rackRect(r, g));
  state.rows = aberto.rows; state.racks = aberto.racks; state.trays = aberto.trays;

  assert.equal(retangulos.length, 3);
  for (const q of retangulos) {
    for (const v of [q.x, q.y, q.w, q.h]) assert.ok(Number.isFinite(v), `rect inválido: ${JSON.stringify(q)}`);
    assert.ok(q.w > 0 && q.h > 0);
  }
  // Os racks andam para a direita na ordem da fileira.
  assert.ok(retangulos[1].x > retangulos[0].x);
  assert.ok(retangulos[2].x > retangulos[1].x);
  // E o estado de quem estava aberto voltou inteiro.
  assert.equal(state.racks, aberto.racks);
});

test('calha antiga (sem coordenadas) ganha pontos pela fileira na prévia', () => {
  resetState(state);
  const rows = [{ id: 'r1', name: '', rackCount: 2, gap: 0, depth: 1.2 },
                { id: 'r2', name: '', rackCount: 2, gap: 1.2, depth: 1.2 }];
  state.rows = rows;
  state.racks = rows.flatMap((row, ri) => [0, 1].map(i => ({ id: `k${ri}${i}`, rowId: row.id, index: i, name: `${i}`, width: 0.6, depth: 1.2 })));
  state.trays = [{ id: 't1', fromRowId: 'r1', toRowId: 'r2', fromIndex: 0, toIndex: 1 }];
  const g = geometry();
  const a = trayPointForRowIndex(rows[0], 0, g, null);
  const b = trayPointForRowIndex(rows[1], 1, g, null);
  for (const v of [a.x, a.y, b.x, b.y]) assert.ok(Number.isFinite(v));
  assert.ok(b.y > a.y, 'a calha sai da fileira 1 para a 2 (para baixo)');
});
