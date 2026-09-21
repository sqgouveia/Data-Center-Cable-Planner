// Catálogos padrão de status/substatus do asset: o que um projeto novo ganha e o que
// normalizeAssetCatalogs acrescenta a um projeto que já tem lista própria.
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../state.js';
import { DEFAULT_ASSET_STATUSES, DEFAULT_ASSET_SUBSTATUSES, normalizeAssetCatalogs } from '../catalogs.js';

test('status e substatus padrão são os do cadastro', () => {
  assert.deepEqual(DEFAULT_ASSET_STATUSES, ['Arquivado', 'No Rack', 'Em Estoque']);
  assert.deepEqual(DEFAULT_ASSET_SUBSTATUSES, [
    'Perdido', 'Retired', 'Retornado ao Vendor', 'Disposed',
    'Ligado', 'Desligado', 'Reservado', 'Em estoque',
  ]);
  // Sem repetição: "Reservado" aparecia duas vezes na lista pedida.
  assert.equal(new Set(DEFAULT_ASSET_SUBSTATUSES).size, DEFAULT_ASSET_SUBSTATUSES.length);
});

test('projeto sem catálogo nenhum fica com os padrões, e quem já tem lista ganha só o que falta', () => {
  state.assets = [];
  state.assetCatalogs = { types: [], manufacturers: [], models: [], statuses: [], substatuses: [] };
  normalizeAssetCatalogs();
  assert.deepEqual(state.assetCatalogs.statuses, DEFAULT_ASSET_STATUSES);
  assert.deepEqual(state.assetCatalogs.substatuses, DEFAULT_ASSET_SUBSTATUSES);

  // Projeto antigo: mantém o que tinha e recebe os novos no fim, sem duplicar.
  state.assetCatalogs = { statuses: ['Instalado'], substatuses: ['Ligado'] };
  normalizeAssetCatalogs();
  assert.equal(state.assetCatalogs.statuses[0], 'Instalado');
  assert.ok(state.assetCatalogs.statuses.includes('No Rack'));
  assert.equal(state.assetCatalogs.substatuses.filter(x => x === 'Ligado').length, 1);
});
