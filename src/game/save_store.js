// Persistent Save / Load / MonkeDex / Party / Toy Shop Store (`monkemon.save.v1`).

import { CORE_SPECIES, getSpecies } from '../data/species.js';
import { createMonkemonInstance, grantExpToMon, refreshMonStats } from './combat_math.js';

export const SAVE_KEY = 'monkemon.save.v1';

export const SHOP_CATALOG = [
  {
    id: 'monkeball_pack',
    name: 'Monkeball ×5 Pack',
    icon: '🐵',
    cost: 80,
    desc: '+5 Smiling Monkeballs for catching wild Monkemon across all 5 islands.',
  },
  {
    id: 'superball',
    name: 'Golden Super Ball ×2',
    icon: '🌟',
    cost: 120,
    desc: '+2 Golden Super Monkeballs (1.85× catch lock-on multiplier in battle & overworld!).',
  },
  {
    id: 'berry_basket',
    name: 'Peanut-Butter Berries ×6',
    icon: '🍌',
    cost: 60,
    desc: '+6 Sweet Peanut-Butter Berries (+42% catch bonus when tossed at wild Monkemon).',
  },
  {
    id: 'banana_parfait',
    name: 'Golden Banana Parfait',
    icon: '🍨',
    cost: 150,
    desc: 'Grants +120 EXP to your active Partner Monkemon & restores 100% Party HP!',
  },
];

export function createInitialGameState(playerName = 'ALEX', starterId = 'mugchimp') {
  const starter = createMonkemonInstance(starterId, 5, { caughtZone: 'sunpalm' });
  return {
    version: 1,
    playerName: String(playerName || 'ALEX').toUpperCase().slice(0, 12),
    zoneId: 'sunpalm',
    pos: { x: -6.0, z: 7.5 },
    party: [starter],
    storage: [],
    activeIndex: 0,
    monkeballs: 18,
    superBalls: 2,
    berries: 10,
    coins: 280,
    badges: [],
    defeatedTrainers: [],
    seenDex: [starterId],
    caughtDex: [starterId],
    starterChosen: false,
    playSeconds: 0,
  };
}

export function markDexSeen(state, speciesId) {
  if (!speciesId) return;
  if (!state.seenDex.includes(speciesId)) state.seenDex.push(speciesId);
}

export function markDexCaught(state, speciesId) {
  if (!speciesId) return;
  markDexSeen(state, speciesId);
  if (!state.caughtDex.includes(speciesId)) state.caughtDex.push(speciesId);
}

export function addCaughtMonToState(state, mon) {
  markDexCaught(state, mon.speciesId);
  if (state.party.length < 6) {
    state.party.push(mon);
    return { inParty: true, slot: state.party.length - 1 };
  }
  state.storage.push(mon);
  return { inParty: false, slot: state.storage.length - 1 };
}

export function healAllParty(state) {
  for (const m of state.party) {
    refreshMonStats(m);
    m.hp = m.maxHp;
  }
}

export function setLeadPartyIndex(state, partyIdx) {
  if (!state || !Array.isArray(state.party)) return false;
  if (partyIdx < 0 || partyIdx >= state.party.length) return false;
  state.activeIndex = partyIdx;
  return true;
}

export function swapPartyWithStorage(state, partyIdx, storageIdx) {
  if (!state || !Array.isArray(state.party) || !Array.isArray(state.storage)) return false;
  if (partyIdx < 0 || partyIdx >= state.party.length) return false;
  if (storageIdx < 0 || storageIdx >= state.storage.length) return false;
  const pMon = state.party[partyIdx];
  const sMon = state.storage[storageIdx];
  refreshMonStats(sMon);
  sMon.hp = Math.max(1, Math.min(sMon.maxHp, sMon.hp || sMon.maxHp));
  state.party[partyIdx] = sMon;
  state.storage[storageIdx] = pMon;
  return true;
}

export function buyShopItem(state, itemId) {
  const item = SHOP_CATALOG.find((it) => it.id === itemId);
  if (!item || !state) return { ok: false, message: 'Unknown item.' };
  if ((state.coins || 0) < item.cost) {
    return { ok: false, message: `Need 🪙 ${item.cost} Coins (you have 🪙 ${state.coins || 0})!` };
  }
  state.coins -= item.cost;
  if (itemId === 'monkeball_pack') {
    state.monkeballs = (state.monkeballs || 0) + 5;
    return { ok: true, message: 'Bought +5 Smiling Monkeballs!' };
  }
  if (itemId === 'superball') {
    state.superBalls = (state.superBalls || 0) + 2;
    return { ok: true, message: 'Bought +2 Golden Super Monkeballs (1.85× Catch)!' };
  }
  if (itemId === 'berry_basket') {
    state.berries = (state.berries || 0) + 6;
    return { ok: true, message: 'Bought +6 Peanut-Butter Berries!' };
  }
  if (itemId === 'banana_parfait') {
    const lead = state.party[state.activeIndex] || state.party[0];
    const lv = lead ? grantExpToMon(lead, 120) : { levelsGained: 0, newLevel: 1 };
    healAllParty(state);
    return {
      ok: true,
      message:
        lv.levelsGained > 0
          ? `🍨 ${lead.nickname} leveled up to Lv.${lv.newLevel} & full squad healed!`
          : `🍨 ${lead ? lead.nickname : 'Partner'} gained +120 EXP & full squad healed!`,
    };
  }
  return { ok: false, message: 'Item unavailable.' };
}

export function saveGameToStorage(state, storage = globalThis.localStorage) {
  if (!storage) return false;
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function loadGameFromStorage(storage = globalThis.localStorage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.party) || parsed.party.length === 0) return null;
    for (const m of parsed.party) {
      getSpecies(m.speciesId);
      refreshMonStats(m);
      m.hp = Math.max(1, Math.min(m.maxHp, m.hp || m.maxHp));
    }
    parsed.storage = Array.isArray(parsed.storage) ? parsed.storage : [];
    parsed.activeIndex = Math.max(0, Math.min(parsed.party.length - 1, parsed.activeIndex || 0));
    parsed.monkeballs = typeof parsed.monkeballs === 'number' ? parsed.monkeballs : 15;
    parsed.superBalls = typeof parsed.superBalls === 'number' ? parsed.superBalls : 2;
    parsed.berries = typeof parsed.berries === 'number' ? parsed.berries : 8;
    parsed.coins = typeof parsed.coins === 'number' ? parsed.coins : 250;
    parsed.badges = Array.isArray(parsed.badges) ? parsed.badges : [];
    parsed.defeatedTrainers = Array.isArray(parsed.defeatedTrainers) ? parsed.defeatedTrainers : [];
    parsed.seenDex = Array.isArray(parsed.seenDex) ? parsed.seenDex : CORE_SPECIES.slice(0, 1).map((s) => s.id);
    parsed.caughtDex = Array.isArray(parsed.caughtDex) ? parsed.caughtDex : [parsed.party[0].speciesId];
    return parsed;
  } catch {
    return null;
  }
}
