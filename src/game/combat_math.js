// Pure, deterministic combat, Monkeball capture, and leveling math for Monkemon.
// Decoupled from DOM/WebGL so `node --test` verifies every formula directly.

import { ELEMENTS, MOVES, TYPE_CHART } from '../data/moves.js';
import { getSpecies } from '../data/species.js';

let _uidSeq = 1;

export function resolveMoveElement(move, species) {
  if (!move) return 'mug';
  if (move.element === 'species') return (species && species.element) || 'mug';
  return move.element || 'mug';
}

export function getTypeMultiplier(attackElem, defElem1, defElem2 = null) {
  const row = TYPE_CHART[attackElem] || {};
  let mult = row[defElem1] ?? 1.0;
  if (defElem2 && defElem2 !== defElem1) {
    mult *= row[defElem2] ?? 1.0;
  }
  return Math.round(mult * 100) / 100;
}

export function computeMaxStats(species, level, isAlpha = false) {
  const lv = Math.max(1, Math.min(99, Math.floor(level || 1)));
  const b = (species && species.baseStats) || { hp: 64, atk: 60, def: 60, spd: 60 };
  const alphaMult = isAlpha ? 1.22 : 1.0;
  const maxHp = Math.round((24 + (b.hp * 2.1 * lv) / 22 + lv * 3.2) * alphaMult);
  const atk = Math.round((10 + (b.atk * 1.65 * lv) / 26 + lv * 1.4) * alphaMult);
  const def = Math.round((10 + (b.def * 1.55 * lv) / 26 + lv * 1.3) * alphaMult);
  const spd = Math.round(10 + (b.spd * 1.4 * lv) / 30);
  return { maxHp, atk, def, spd };
}

export function expRequiredForLevel(level) {
  const lv = Math.max(1, Math.floor(level || 1));
  if (lv < 20) {
    return 25 * lv * lv + 35 * lv;
  }
  return 10700 + (lv - 19) * 1200;
}

export function createMonkemonInstance(speciesId, level = 5, opts = {}) {
  const sp = getSpecies(speciesId);
  const lv = Math.max(1, Math.min(99, Math.floor(level)));
  const isAlpha = Boolean(opts.isAlpha);
  const stats = computeMaxStats(sp, lv, isAlpha);
  const moveIds = (opts.moves || sp.moves || ['monk_run', 'fake_out', 'eat_snack', 'sky_jump', 'espresso_geyser'])
    .filter((m) => Boolean(MOVES[m]));
  return {
    uid: opts.uid || `mon_${Date.now().toString(36)}_${_uidSeq++}`,
    speciesId: sp.id,
    nickname: opts.nickname || sp.name,
    level: lv,
    exp: opts.exp || 0,
    isAlpha,
    maxHp: stats.maxHp,
    hp: typeof opts.hp === 'number' ? Math.max(0, Math.min(stats.maxHp, opts.hp)) : stats.maxHp,
    atk: stats.atk,
    def: stats.def,
    spd: stats.spd,
    moves: moveIds,
    caughtZone: opts.caughtZone || 'sunpalm',
  };
}

export function refreshMonStats(mon) {
  const sp = getSpecies(mon.speciesId);
  const prevMax = mon.maxHp || 1;
  const stats = computeMaxStats(sp, mon.level, mon.isAlpha);
  const hpGain = Math.max(0, stats.maxHp - prevMax);
  mon.maxHp = stats.maxHp;
  mon.atk = stats.atk;
  mon.def = stats.def;
  mon.spd = stats.spd;
  mon.hp = Math.min(mon.maxHp, Math.max(0, mon.hp + hpGain));
  return mon;
}

export function grantExpToMon(mon, rawExp) {
  const gained = Math.max(1, Math.round(rawExp));
  mon.exp = (mon.exp || 0) + gained;
  let levelsGained = 0;
  while (mon.level < 99) {
    const req = expRequiredForLevel(mon.level);
    if (mon.exp < req) break;
    mon.exp -= req;
    mon.level += 1;
    levelsGained += 1;
    refreshMonStats(mon);
    // Mid-journey level-up mend (+25% maxHp)
    mon.hp = Math.min(mon.maxHp, mon.hp + Math.ceil(mon.maxHp * 0.25));
  }
  return { gained, levelsGained, newLevel: mon.level };
}

export function computeComboMultiplier(comboCount = 0) {
  const c = Math.max(0, Math.floor(comboCount || 0));
  if (c <= 1) return 1.0;
  return Math.min(1.5, Math.round((1.0 + (c - 1) * 0.08) * 100) / 100);
}

export function calculateHitDamage(attackerMon, defenderMon, move, opts = {}) {
  const atkSp = getSpecies(attackerMon.speciesId);
  const defSp = getSpecies(defenderMon.speciesId);
  const elem = resolveMoveElement(move, atkSp);
  const typeMult = getTypeMultiplier(elem, defSp.element, defSp.secondaryElement);
  const stab = elem === atkSp.element || elem === atkSp.secondaryElement ? 1.15 : 1.0;
  const atkBuff = opts.attackerBuffed ? 1.28 : 1.0;
  const comboMult = computeComboMultiplier(opts.comboCount || 0);
  const rngVal = typeof opts.rng === 'number' ? opts.rng : Math.random();
  const isCrit = Boolean(opts.forceCrit) || rngVal > 0.91;
  const critMult = isCrit ? 1.42 : 1.0;
  const variance = 0.92 + (rngVal * 0.16);

  const power = Math.max(10, move.power || 45);
  const raw =
    (((2 * attackerMon.level) / 5 + 4) * power * (attackerMon.atk * atkBuff * comboMult)) /
      (Math.max(8, defenderMon.def) * 18) +
    3;
  const damage = Math.max(2, Math.round(raw * stab * typeMult * critMult * variance));

  let label = '';
  if (typeMult >= 1.35) label = 'SUPER EFFECTIVE!';
  else if (typeMult <= 0.75) label = 'Not very effective...';

  const elemMeta = ELEMENTS[elem] || ELEMENTS.mug;
  return {
    damage,
    element: elem,
    elementColor: elemMeta.color,
    effectiveness: typeMult,
    comboMult,
    isCrit,
    label,
  };
}

export function gradeTimingRing(ringRadiusNorm) {
  // ringRadiusNorm shrinks from 1.0 down to 0.18; smaller sweet-spot = higher catch bonus!
  const r = Math.max(0.15, Math.min(1.0, ringRadiusNorm));
  if (r <= 0.34) return { grade: 'EXCELLENT!', mult: 1.7, color: '#fbbf24' };
  if (r <= 0.58) return { grade: 'GREAT!', mult: 1.38, color: '#38bdf8' };
  if (r <= 0.82) return { grade: 'NICE!', mult: 1.16, color: '#4ade80' };
  return { grade: 'THROW!', mult: 1.0, color: '#e2e8f0' };
}

export function computeCatchProbability({
  species,
  currentHp,
  maxHp,
  ringMult = 1.0,
  berryFed = false,
  ballBonus = 1.0,
  badgesCount = 0,
}) {
  const baseRate = (species && species.catchRate) || 0.5;
  const hpFrac = Math.max(0.02, Math.min(1.0, (currentHp || 1) / Math.max(1, maxHp || 1)));
  // Weakening a wild Monkemon dramatically improves Monkeball lock-on (up to 2.35x at red HP)
  const hpFactor = 1.0 + (1.0 - hpFrac) * 1.35;
  const berryMult = berryFed ? 1.42 : 1.0;
  const badgeMult = 1.0 + Math.min(4, badgesCount) * 0.06;
  const prob = baseRate * hpFactor * ringMult * berryMult * ballBonus * badgeMult;
  return Math.max(0.08, Math.min(0.98, Math.round(prob * 1000) / 1000));
}

export function computeCoastRadiusNorm(theta, coastParams = [0.1, 0.08, 0.05, 0.7], lobeDirs = []) {
  const [a2 = 0.1, a3 = 0.08, a5 = 0.05, phase = 0.7] = coastParams;
  let r =
    0.96 +
    a2 * Math.cos(2.0 * theta + phase) +
    a3 * Math.sin(3.0 * theta - phase * 1.35) +
    a5 * Math.cos(5.0 * theta + phase * 2.1);

  for (const lAngle of lobeDirs) {
    let d = theta - lAngle;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    r = Math.max(r, 1.03 * Math.exp(-(d * d) / 0.11));
  }
  return Math.max(0.72, Math.min(1.16, r));
}

export function getBattleMoves(mon, species) {
  const sp = species || getSpecies(mon ? mon.speciesId : 'mugchimp');
  const rawIds = [
    ...(Array.isArray(mon && mon.moves) ? mon.moves : []),
    ...(Array.isArray(sp && sp.moves) ? sp.moves : []),
  ];
  const specialId =
    rawIds.find((id) => MOVES[id] && !['monk_run', 'fake_out', 'eat_snack', 'sky_jump'].includes(id)) ||
    'espresso_geyser';

  const ordered = [specialId, 'monk_run', 'sky_jump', 'eat_snack', 'fake_out'];
  const unique = [];
  for (const id of ordered) {
    if (MOVES[id] && !unique.includes(id)) unique.push(id);
    if (unique.length === 4) break;
  }
  return unique.map((id) => MOVES[id]);
}
