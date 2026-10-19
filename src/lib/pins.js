/**
 * Pin store — per-wallet pinned squads persisted in localStorage, plus
 * membership checks and boot-mode selection for lockdown mode.
 *
 * The store shape in localStorage (key: 'pinnedSquads'):
 *   { "<wallet pubkey base58>": [{ multisigAddress, label, pinnedAt }] }
 *
 * An in-memory cache is the working copy; localStorage writes are
 * best-effort so a quota failure never loses session state.
 */

const STORE_KEY = 'pinnedSquads';
const STICKY_OPEN_KEY = 'stickyOpen';
const MAX_LABEL_LENGTH = 32;

let cache = null;

function readStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const store = {};
    for (const [wallet, pins] of Object.entries(parsed)) {
      if (!Array.isArray(pins)) continue;
      const valid = pins.filter((p) => p && typeof p.multisigAddress === 'string');
      if (valid.length > 0) store[wallet] = valid;
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

export function reloadPinStore() {
  cache = null;
}

export function getPins(walletAddress) {
  return ensureLoaded()[walletAddress] || [];
}

export function hasAnyPins() {
  return Object.values(ensureLoaded()).some((pins) => pins.length > 0);
}

export function addPin(walletAddress, { multisigAddress, label = '' }) {
  const store = ensureLoaded();
  const pins = store[walletAddress] || [];
  if (pins.some((p) => p.multisigAddress === multisigAddress)) {
    return { pins, persisted: true };
  }
  const updated = [...pins, {
    multisigAddress,
    label: String(label).slice(0, MAX_LABEL_LENGTH),
    pinnedAt: Date.now(),
  }];
  store[walletAddress] = updated;
  return { pins: updated, persisted: persist() };
}

export function removePin(walletAddress, multisigAddress) {
  const store = ensureLoaded();
  const updated = (store[walletAddress] || []).filter((p) => p.multisigAddress !== multisigAddress);
  if (updated.length === 0) delete store[walletAddress];
  else store[walletAddress] = updated;
  return { pins: updated, persisted: persist() };
}

/**
 * The on-chain multisig account is the source of truth for membership.
 * `multisig` is the object returned by deserializeMultisig().
 */
export function findMember(multisig, walletAddress) {
  return multisig.members.find((m) => m.key === walletAddress) || null;
}

/**
 * Boot-mode selection: an explicit same-session toggle wins; otherwise
 * lockdown whenever pins exist, unless the user persisted "stay in open".
 */
export function resolveBootMode({ hasPins, stickyOpen, sessionMode }) {
  if (sessionMode === 'open' || sessionMode === 'lockdown') return sessionMode;
  return hasPins && !stickyOpen ? 'lockdown' : 'open';
}

export function isStickyOpen() {
  return localStorage.getItem(STICKY_OPEN_KEY) === '1';
}

export function setStickyOpen(value) {
  if (value) localStorage.setItem(STICKY_OPEN_KEY, '1');
  else localStorage.removeItem(STICKY_OPEN_KEY);
}
