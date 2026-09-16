// Ocupação física de rack, por face. Duas faces do mesmo rack têm ocupação
// independente: cabe um asset na frente e outro atrás da mesma U.
//
// Puro de propósito, no mesmo espírito de geometry.js: recebe a lista de
// assets por parâmetro em vez de ler `state`, e não toca DOM. É o que permite
// testar a regra "mesma face conflita, faces opostas não" sob Node — regra que
// vale em quatro caminhos independentes (bayface, modal, lote, importação) e
// que quebra em silêncio se um deles esquecer o filtro.
import { num } from './utils.js';

export function isAssetArchived(asset) {
  return String(asset?.status || '') === 'Arquivado';
}

export function assetOccupancy(asset) {
  const start = Math.floor(num(asset?.uStart, 1));
  const height = Math.max(1, Math.floor(num(asset?.uHeight, 1)));
  return { start, end: start + height - 1 };
}

function coversU(asset, u) {
  const o = assetOccupancy(asset);
  return u >= o.start && u <= o.end;
}

export function assetsOnFace(assets, rackId, face) {
  if (!rackId) return [];
  return (assets || []).filter(a => a && a.rackId === rackId && !isAssetArchived(a) && (a.face || 'front') === face);
}

export function assetAtRackU(assets, rackId, u, face) {
  return assetsOnFace(assets, rackId, face).find(a => coversU(a, u)) || null;
}

export function assetsAtRackU(assets, rackId, u) {
  if (!rackId) return [];
  return (assets || []).filter(a => a && a.rackId === rackId && !isAssetArchived(a) && coversU(a, u));
}

export function assetOwningPort(assets, portId) {
  if (!portId) return null;
  return (assets || []).find(a => Array.isArray(a?.ports) && a.ports.some(p => p && p.id === portId)) || null;
}

export function assetConflicts(assets, asset, ignoreId = null) {
  if (!asset?.rackId) return false;
  const a = assetOccupancy(asset);
  const assetFace = asset.face || 'front';
  return (assets || []).some(x => {
    if (!x || x.id === ignoreId || x.rackId !== asset.rackId) return false;
    if ((x.face || 'front') !== assetFace || isAssetArchived(x)) return false;
    const b = assetOccupancy(x);
    return a.start <= b.end && b.start <= a.end;
  });
}

export function occupiedUnits(assets, rackId, face) {
  const used = new Set();
  assetsOnFace(assets, rackId, face).forEach(a => {
    const o = assetOccupancy(a);
    for (let u = o.start; u <= o.end; u++) used.add(u);
  });
  return used;
}
