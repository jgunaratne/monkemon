// Persistent Save / Load / MonkeDex / Party / Bag Store (`monkemon.save.v1`).

import { CORE_SPECIES, getSpecies } from '../data/species.js';
import { createMonkemonInstance, refreshMonStats } from './combat_math.js';

export const SAVE_KEY = 'monkemon.save.v1';

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
    berries: 10,
    coins: 250,
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
    parsed.activeIndex = Math.max(0, Math.min(parsed.party.length - 1, parsed.activeIndex || 0));
    parsed.monkeballs = typeof parsed.monkeballs === 'number' ? parsed.monkeballs : 15;
    parsed.berries = typeof parsed.berries === 'number' ? parsed.berries : 8;
    parsed.badges = Array.isArray(parsed.badges) ? parsed.badges : [];
    parsed.defeatedTrainers = Array.isArray(parsed.defeatedTrainers) ? parsed.defeatedTrainers : [];
    parsed.seenDex = Array.isArray(parsed.seenDex) ? parsed.seenDex : CORE_SPECIES.slice(0, 1).map((s) => s.id);
    parsed.caughtDex = Array.isArray(parsed.caughtDex) ? parsed.caughtDex : [parsed.party[0].speciesId];
    return parsed;
  } catch {
    return null;
  }
}
