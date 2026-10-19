/**
 * User-local program labels — cosmetic nicknames for program ids, stored in
 * localStorage (key: 'programLabels' → { programId: label }). Labels never
 * affect decode logic or trust display; they only replace the shortened
 * pubkey in the program column. Cache-first like the pin store.
 */

const STORE_KEY = 'programLabels';
const MAX_LABEL_LENGTH = 32;

let cache = null;

function readStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const store = {};
    for (const [id, label] of Object.entries(parsed)) {
      if (typeof label === 'string' && label.length > 0) store[id] = label;
    }
    return store;
  } catch {
    return {};
  }
}

function ensureLoaded() {
  if (cache === null) cache = readStore();
  return cache;
}

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(cache));
    return true;
  } catch {
    return false;
  }
}

export function reloadProgramLabels() {
  cache = null;
}

export function getProgramLabel(programId) {
  return ensureLoaded()[programId] || null;
}

export function setProgramLabel(programId, label) {
  const store = ensureLoaded();
  const trimmed = String(label).trim().slice(0, MAX_LABEL_LENGTH);
  if (trimmed.length === 0) delete store[programId];
  else store[programId] = trimmed;
  return { persisted: persist() };
}
