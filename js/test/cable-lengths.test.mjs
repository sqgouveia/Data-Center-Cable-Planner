// Metragem comercial: o cabo calculado vira a menor metragem da tabela do fornecedor que o cobre.
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCableLengths, commercialLength } from '../utils.js';

test('tabela fica ordenada, sem repetição, sem metragem inválida, preço opcional', () => {
  assert.deepEqual(
    normalizeCableLengths([{ m: '5', price: '12,5' }, { m: 2 }, { m: 0 }, { m: 'x' }, { m: 2, price: 3 }, { m: 10, price: '' }]),
    [{ m: 2, price: 3 }, { m: 5, price: 12.5 }, { m: 10 }],
  );
  assert.deepEqual(normalizeCableLengths(undefined), []);
});

test('escolhe a menor metragem que cobre o total', () => {
  const t = [{ m: 1 }, { m: 3, price: 20 }, { m: 5, price: 30 }];
  assert.deepEqual(commercialLength(2.1, t), { m: 3, price: 20, over: false });
  assert.deepEqual(commercialLength(3, t), { m: 3, price: 20, over: false });
  assert.deepEqual(commercialLength(0.4, t), { m: 1, price: null, over: false });
});

test('sem tabela arredonda para cima; acima da maior metragem avisa', () => {
  assert.deepEqual(commercialLength(3.2, []), { m: 4, price: null, over: false });
  assert.deepEqual(commercialLength(3.2, undefined), { m: 4, price: null, over: false });
  assert.deepEqual(commercialLength(7.2, [{ m: 5 }]), { m: 8, price: null, over: true });
});
