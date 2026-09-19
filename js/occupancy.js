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

// Problemas de posição que a interface não deveria deixar criar, mas que podem
// vir de dados antigos, importados ou editados fora do app: dois assets
// ocupando a mesma U na mesma face, ou um asset fora das U do rack.
// `unitsByRack` é um Map rackId -> altura do rack em U.
export function assetPositionProblems(assets, unitsByRack) {
  const problems = [];
  const groups = new Map();
  for (const a of assets || []) {
    if (!a || !a.rackId || isAssetArchived(a) || !unitsByRack.has(a.rackId)) continue;
    const o = assetOccupancy(a);
    const units = unitsByRack.get(a.rackId);
    if (o.start < 1 || o.end > units) problems.push({ kind: 'outside', rackId: a.rackId, asset: a, units, start: o.start, end: o.end });
    const key = `${a.rackId}|${(a.face || 'front') === 'rear' ? 'rear' : 'front'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ asset: a, ...o });
  }
  for (const [key, list] of groups) {
    list.sort((x, y) => x.start - y.start || x.end - y.end);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length && list[j].start <= list[i].end; j++) {
        problems.push({ kind: 'overlap', rackId: key.split('|')[0], face: key.split('|')[1], a: list[i].asset, b: list[j].asset });
      }
    }
  }
  return problems;
}

// Maior U ocupada por assets não arquivados do rack (0 se não há nenhum).
export function highestOccupiedU(assets, rackId) {
  let top = 0;
  for (const a of assets || []) {
    if (!a || a.rackId !== rackId || isAssetArchived(a)) continue;
    top = Math.max(top, assetOccupancy(a).end);
  }
  return top;
}
