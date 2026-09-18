// Métricas de rack para o mapa de calor, o resumo do rack e o resumo da sala.
//
// Puro de propósito, no mesmo espírito de occupancy.js e geometry.js: recebe
// racks e assets por parâmetro, não lê `state` nem toca DOM. Isso permite testar
// sob Node as regras que decidem a cor de cada rack.
import { num } from './utils.js';
import { isAssetArchived, assetOccupancy } from './occupancy.js';

export const HEAT_MODES = ['off', 'u', 'power', 'weight', 'alerts'];

// Razão usado/capacidade -> nível de cor. `null` = sem capacidade definida.
// >100% é excesso (l4); 80% é o mesmo limiar de alerta de capacidadeIssues().
export function levelForRatio(ratio) {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return 'none';
  if (ratio > 1) return 'l4';
  if (ratio >= 0.8) return 'l3';
  if (ratio >= 0.5) return 'l2';
  return 'l1';
}

function ratioOf(used, capacity) {
  return capacity > 0 ? used / capacity : null;
}

// `lifecycleLevel(asset)` devolve 'expired' | 'soon' | outro (ok). Vem de fora
// porque os prazos de aviso de garantia/EOL vivem em app.js.
export function rackMetrics(rack, rackAssets, { defaultUnits = 42, lifecycleLevel = () => 'ok' } = {}) {
  const totalU = Math.max(1, Math.floor(num(rack?.units, defaultUnits)));
  const front = new Set(), rear = new Set();
  let powerW = 0, weightKg = 0, expired = 0, soon = 0;
  for (const a of rackAssets) {
    powerW += Math.max(0, num(a.powerW, 0));
    weightKg += Math.max(0, num(a.weightKg, 0));
    const life = lifecycleLevel(a);
    if (life === 'expired') expired++;
    else if (life === 'soon') soon++;
    if (isAssetArchived(a)) continue;
    const o = assetOccupancy(a);
    const face = (a.face || 'front') === 'rear' ? rear : front;
    for (let u = Math.max(1, o.start); u <= Math.min(totalU, o.end); u++) face.add(u);
  }
  const used = new Set([...front, ...rear]);
  const powerCap = num(rack?.powerCapacityW, 0);
  const weightCap = num(rack?.weightCapacityKg, 0);
  const powerRatio = ratioOf(powerW, powerCap);
  const weightRatio = ratioOf(weightKg, weightCap);
  const usedU = used.size;
  let alertLevel = 'l1';
  if (soon > 0 || (powerRatio !== null && powerRatio >= 0.8) || (weightRatio !== null && weightRatio >= 0.8)) alertLevel = 'l3';
  if (expired > 0 || (powerRatio !== null && powerRatio > 1) || (weightRatio !== null && weightRatio > 1)) alertLevel = 'l4';
  return {
    rackId: rack?.id, totalU, usedU, freeU: totalU - usedU, frontU: front.size, rearU: rear.size,
    uRatio: usedU / totalU, assetCount: rackAssets.length,
    powerW, powerCap, powerRatio, weightKg, weightCap, weightRatio,
    expired, soon, alertLevel,
  };
}

// Um passe pelos assets, agrupados por rack. Devolve Map<rackId, métricas>.
export function computeRackMetrics(racks, assets, options = {}) {
  const byRack = new Map();
  for (const a of assets || []) {
    if (!a || !a.rackId) continue;
    if (!byRack.has(a.rackId)) byRack.set(a.rackId, []);
    byRack.get(a.rackId).push(a);
  }
  const out = new Map();
  for (const r of racks || []) out.set(r.id, rackMetrics(r, byRack.get(r.id) || [], options));
  return out;
}

// Nível de cor do rack no modo escolhido. `null` = modo normal (sem cor extra).
export function heatLevel(metrics, mode) {
  if (!metrics) return null;
  switch (mode) {
    case 'u': return levelForRatio(metrics.uRatio);
    case 'power': return levelForRatio(metrics.powerRatio);
    case 'weight': return levelForRatio(metrics.weightRatio);
    case 'alerts': return metrics.alertLevel;
    default: return null;
  }
}

// Totais da sala a partir das métricas dos seus racks.
export function summarizeRackMetrics(list) {
  const s = {
    racks: 0, totalU: 0, usedU: 0, freeU: 0, uRatio: null, assetCount: 0,
    powerW: 0, powerCap: 0, powerRatio: null, weightKg: 0, weightCap: 0, weightRatio: null,
    racksOver: 0, racksNear: 0, expired: 0, soon: 0,
  };
  let cappedPowerW = 0, cappedWeightKg = 0;
  for (const m of list) {
    s.racks++; s.totalU += m.totalU; s.usedU += m.usedU; s.assetCount += m.assetCount;
    s.powerW += m.powerW; s.weightKg += m.weightKg; s.expired += m.expired; s.soon += m.soon;
    if (m.powerCap > 0) { s.powerCap += m.powerCap; cappedPowerW += m.powerW; }
    if (m.weightCap > 0) { s.weightCap += m.weightCap; cappedWeightKg += m.weightKg; }
    const worst = Math.max(m.powerRatio ?? 0, m.weightRatio ?? 0);
    if (worst > 1) s.racksOver++; else if (worst >= 0.8) s.racksNear++;
  }
  s.freeU = s.totalU - s.usedU;
  s.uRatio = s.totalU > 0 ? s.usedU / s.totalU : null;
  s.powerRatio = ratioOf(cappedPowerW, s.powerCap);
  s.weightRatio = ratioOf(cappedWeightKg, s.weightCap);
  return s;
}
