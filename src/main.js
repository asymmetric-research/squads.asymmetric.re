import '../style.css';
import { init, getState, setState } from './state.js';
import { createWalletManager } from './wallet.js';
import { fetchMultisig, fetchMultisigBatch, fetchProposalBatch, fetchTransaction } from './rpc.js';
import { resolveMultisigAddress } from './resolver.js';
import { deserializeMultisig, deserializeProposal, getProposalPda, getTransactionPda, shortenAddress, PROPOSAL_DISCRIMINATOR, VAULT_TX_DISCRIMINATOR, CONFIG_TX_DISCRIMINATOR } from './squads.js';
import { renderLayout, renderSetup, showToast, renderWalletPicker } from './ui-layout.js';
import { renderLockdownHome } from './ui-lockdown.js';
import { getPins, addPin, removePin, findMember } from './pins.js';

// Generation guards for async race condition protection
function createGuard() {
  let current = 0;
  return {
    next() { return ++current; },
    isStale(captured) { return captured !== current; },
    get current() { return current; },
  };
}

const settingsGuard = createGuard();
const paginationGuard = createGuard();
const expandGuard = createGuard();

// Per-proposal action states: Map<string, 'idle'|'refetching'|'signing'|'confirming'>
const proposalActions = new Map();

let walletManager = null;

// MutationObserver: detect runtime script injection
new MutationObserver((mutations) => {
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (node.tagName === 'SCRIPT' && !node.hasAttribute('data-webpack')) {
        document.body.textContent = 'Security violation: unexpected script detected. Reload from a trusted source.';
        throw new Error('Script injection detected');
      }
    }
  }
}).observe(document.documentElement, { childList: true, subtree: true });

// Tab visibility: refresh on return after 30s
let lastVisibleTimestamp = Date.now();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    const elapsed = Date.now() - lastVisibleTimestamp;
    if (elapsed > 30_000) {
      const anyActionInProgress = [...proposalActions.values()].some(s => s !== 'idle');
      if (!anyActionInProgress) {
        settingsGuard.next();
        loadProposals();
      }
    }
  } else {
    lastVisibleTimestamp = Date.now();
  }
});

// Cross-tab localStorage detection
window.addEventListener('storage', (e) => {
  if (['multisigAddress', 'pinnedSquads'].includes(e.key)) {
    const anyActionInProgress = [...proposalActions.values()].some(s => s !== 'idle');
    if (anyActionInProgress) return;
    showToast('Settings changed in another tab. Reloading...', 'info');
    setTimeout(() => location.reload(), 1500);
  }
});

// Main render
function render() {
  const state = getState();
  const root = document.getElementById('app');
  if (!root) return;

  root.textContent = '';
  root.className = '';

  const layoutHandlers = {
    state,
    walletManager,
    proposalActions,
    onConnect,
    onDisconnect,
    onRefresh,
    onLoadMore,
    onExpandProposal,
    onApprove,
    onReject,
    onSwitchMode,
    onStickyOpenChange,
    onBackToSquads,
  };

  if (state.mode === 'lockdown') {
    root.className = 'app';
    if (!state.lockdownActive) {
      root.appendChild(renderLockdownHome({
        state,
        walletManager,
        onAddPin,
        onUnpin,
        onOpenSquad,
        onRetryPins: loadPins,
        onSwitchMode,
      }));
      if (state.showWalletPicker) {
        root.appendChild(renderWalletPicker(walletManager));
      }
      return;
    }
    root.appendChild(renderLayout(layoutHandlers));
    return;
  }

  if (!state.multisigAddress || !state.rpcUrl) {
    root.appendChild(renderSetup(onSetupComplete, { state, onSwitchMode }));
    return;
  }

  root.className = 'app';
  root.appendChild(renderLayout(layoutHandlers));
}

// Module-level guard: a re-render mid-resolution rebuilds the setup card with
// a fresh (enabled) button, so the per-card disable alone can't prevent a
// second concurrent resolution.
let setupResolving = false;

async function onSetupComplete(address) {
  if (setupResolving) return;
  setupResolving = true;
  const { rpcUrl } = getState();
  try {
    const resolved = await resolveMultisigAddress(rpcUrl, address);

    if (resolved.type === 'multisig') {
      if (resolved.resolvedFrom) {
        showToast(resolved.message || ('Resolved to multisig: ' + resolved.multisigAddress.slice(0, 8) + '...'), 'info');
      }
      setState({ multisigAddress: resolved.multisigAddress });
      await loadMultisig();
      await loadProposals();
    } else {
      showToast(resolved.message, 'error');
    }
  } catch (err) {
    showToast('Failed to resolve address: ' + err.message, 'error');
  } finally {
    setupResolving = false;
  }
}

async function onConnect(wallet) {
  try {
    const account = await walletManager.connect(wallet);
    setState({ walletAccount: account, connectedWallet: wallet });
  } catch (err) {
    if (err?.code !== 4001) {
      showToast('Connection failed: ' + (err.message || 'Unknown error'), 'error');
    }
  }
}

async function onDisconnect() {
  await walletManager.disconnect();
  setState({ walletAccount: null, connectedWallet: null });
}

async function onRefresh() {
  settingsGuard.next();
  setState({ lastUpdated: null });
  await loadMultisig();
  await loadProposals();
}

async function onLoadMore() {
  const state = getState();
  if (state.loadingMore) return;

  const nextEnd = state.proposalCursor - 1;
  const nextStart = Math.max(1, nextEnd - 19);
  if (nextEnd < 1) return;

  setState({ loadingMore: true });
  const gen = paginationGuard.next();

  try {
    const batch = await fetchProposalBatch(state.rpcUrl, state.multisigAddress, nextStart, nextEnd);
    if (paginationGuard.isStale(gen)) return;

    setState({
      proposals: [...state.proposals, ...batch],
      proposalCursor: nextStart,
      loadingMore: false,
    });
  } catch (err) {
    if (paginationGuard.isStale(gen)) return;
    showToast('Failed to load more: ' + err.message, 'error');
  } finally {
    setState({ loadingMore: false });
  }
}

async function onExpandProposal(index) {
  const state = getState();
  if (state.expandedProposal === index) {
    setState({ expandedProposal: null, expandedTransaction: null });
    return;
  }

  setState({ expandedProposal: index, expandedTransaction: null, loadingDetail: true });
  const gen = expandGuard.next();

  try {
    const tx = await fetchTransaction(state.rpcUrl, state.multisigAddress, index);
    if (expandGuard.isStale(gen)) return;
    setState({ expandedTransaction: tx, loadingDetail: false });
  } catch (err) {
    if (expandGuard.isStale(gen)) return;
    showToast('Failed to load transaction: ' + err.message, 'error');
    setState({ loadingDetail: false });
  }
}

async function onApprove(index) {
  await executeVote(index, true);
}

async function onReject(index) {
  await executeVote(index, false);
}

async function executeVote(index, approve) {
  const key = String(index);
  if (proposalActions.get(key) && proposalActions.get(key) !== 'idle') {
    showToast('An action is already in progress for this proposal.', 'info');
    return;
  }

  const state = getState();
  if (!walletManager || !walletManager.isConnected()) {
    showToast('Please connect your wallet first.', 'error');
    return;
  }

  proposalActions.set(key, 'refetching');
  render();

  const gen = settingsGuard.next();

  try {
    // Dynamic import to keep initial load light
    const { buildVoteTransaction } = await import('./actions.js');
    if (settingsGuard.isStale(gen)) return;

    // Re-fetch proposal to check for stale state
    const freshProposals = await fetchProposalBatch(state.rpcUrl, state.multisigAddress, index, index);
    if (settingsGuard.isStale(gen)) return;

    const proposal = freshProposals[0];
    if (!proposal || proposal.status.tag !== 1) {
      showToast('Proposal is no longer active (status: ' + (proposal?.status.name || 'unknown') + ')', 'error');
      return;
    }

    proposalActions.set(key, 'signing');
    render();

    const account = walletManager.getAccount();
    const txBytes = await buildVoteTransaction(
      state.multisigAddress,
      account.address,
      index,
      approve,
      state.rpcUrl
    );

    const signature = await walletManager.signAndSendTransaction(txBytes);
    if (settingsGuard.isStale(gen)) return;

    proposalActions.set(key, 'confirming');
    render();
    showToast('Transaction sent! Confirming...', 'info');

    // Refresh the proposal after a short delay
    await new Promise(r => setTimeout(r, 2000));
    if (settingsGuard.isStale(gen)) return;

    await loadProposals();
    showToast(
      (approve ? 'Approved' : 'Rejected') + ' proposal #' + index,
      'success'
    );
  } catch (err) {
    if (err?.code === 4001 || (err?.message || '').toLowerCase().includes('user rejected')) {
      // User cancelled — silently reset
    } else {
      showToast('Vote failed: ' + (err.message || 'Unknown error'), 'error');
    }
  } finally {
    proposalActions.set(key, 'idle');
    render();
  }
}

async function loadMultisig() {
  const state = getState();
  if (!state.multisigAddress) return;

  setState({ loading: true, error: null });
  const gen = settingsGuard.current;

  try {
    const multisig = await fetchMultisig(state.rpcUrl, state.multisigAddress);
    if (settingsGuard.isStale(gen)) return;
    setState({ multisig, loading: false });
  } catch (err) {
    if (settingsGuard.isStale(gen)) return;
    setState({ loading: false, error: 'Failed to load multisig: ' + err.message, multisig: null, proposals: [] });
    showToast('Failed to load multisig: ' + err.message, 'error');
  }
}

async function loadProposals() {
  const state = getState();
  if (!state.multisig) return;

  setState({ loadingProposals: true });
  const gen = paginationGuard.next();

  try {
    const txIndex = Number(state.multisig.transactionIndex);
    const start = Math.max(1, txIndex - 19);

    const proposals = await fetchProposalBatch(state.rpcUrl, state.multisigAddress, start, txIndex);
    if (paginationGuard.isStale(gen)) return;

    // Initialize action states for each proposal
    for (const p of proposals) {
      if (!proposalActions.has(String(p.index))) {
        proposalActions.set(String(p.index), 'idle');
      }
    }

    setState({
      proposals,
      proposalCursor: start,
      loadingProposals: false,
      lastUpdated: new Date(),
    });
  } catch (err) {
    if (paginationGuard.isStale(gen)) return;
    showToast('Failed to load proposals: ' + err.message, 'error');
    setState({ loadingProposals: false });
  }
}

// ─── Lockdown mode ───

async function loadPins() {
  const state = getState();
  const wallet = state.walletAccount?.address;
  if (!wallet) return;

  const pins = getPins(wallet);
  setState({ loadingPins: true, pinsError: null });

  try {
    const results = await fetchMultisigBatch(state.rpcUrl, pins.map((p) => p.multisigAddress));
    // Wallet may have changed while fetching — results belong to `wallet`
    if (getState().walletAccount?.address !== wallet) return;

    const pinned = pins.map((p, i) => ({
      ...p,
      multisig: results[i].multisig,
      error: results[i].error,
      // Re-verified on every load: the on-chain roster is the source of truth
      membership: results[i].multisig ? findMember(results[i].multisig, wallet) : null,
    }));
    setState({ pinned, loadingPins: false });
  } catch (err) {
    if (getState().walletAccount?.address !== wallet) return;
    setState({ loadingPins: false, pinsError: 'Failed to load squads: ' + err.message });
  }
}

async function onAddPin(input, label) {
  const state = getState();
  const wallet = state.walletAccount?.address;
  if (!wallet) {
    showToast('Connect your wallet first.', 'error');
    return false;
  }

  // Never pin unverified: resolve, fetch, and membership-check must all
  // succeed before the pin is written.
  const resolved = await resolveMultisigAddress(state.rpcUrl, input);
  if (resolved.type !== 'multisig') {
    showToast(resolved.message || 'Not a Squads v4 multisig.', 'error');
    return false;
  }

  const multisig = await fetchMultisig(state.rpcUrl, resolved.multisigAddress);
  const member = findMember(multisig, wallet);
  if (!member) {
    showToast('Refused: wallet ' + shortenAddress(wallet) + ' is not a member of this multisig.', 'error');
    return false;
  }

  const { persisted } = addPin(wallet, { multisigAddress: resolved.multisigAddress, label });
  if (!persisted) {
    showToast('Pinned for this session, but saving to browser storage failed.', 'error');
  } else if (resolved.resolvedFrom) {
    showToast('Resolved to multisig: ' + resolved.multisigAddress.slice(0, 8) + '…', 'info');
  }
  await loadPins();
  return true;
}

function onUnpin(multisigAddress) {
  const wallet = getState().walletAccount?.address;
  if (!wallet) return;
  removePin(wallet, multisigAddress);
  loadPins();
}

async function onOpenSquad(multisigAddress) {
  setState({ lockdownActive: multisigAddress, multisigAddress, multisig: null, proposals: [], expandedProposal: null, expandedTransaction: null });
  await loadMultisig();
  await loadProposals();
}

function onBackToSquads() {
  settingsGuard.next();
  setState({ lockdownActive: null, multisig: null, proposals: [], expandedProposal: null, expandedTransaction: null, error: null });
  loadPins();
}

function onSwitchMode(mode) {
  settingsGuard.next();
  setState({ mode, lockdownActive: null, expandedProposal: null, expandedTransaction: null });
  if (mode === 'lockdown' && getState().walletAccount) {
    loadPins();
  }
}

function onStickyOpenChange(checked) {
  setState({ stickyOpen: checked });
}

// Boot
async function boot() {
  walletManager = createWalletManager({ chain: 'solana:mainnet' });

  walletManager.addEventListener('connectionChanged', (info) => {
    if (info) {
      setState({ walletAccount: info.account, connectedWallet: info.wallet });
      if (getState().mode === 'lockdown') loadPins();
    } else {
      // Wallet disconnected — cancel in-flight actions
      for (const [key] of proposalActions) {
        proposalActions.set(key, 'idle');
      }
      settingsGuard.next();
      setState({ walletAccount: null, connectedWallet: null, pinned: [], lockdownActive: null });
    }
  });

  walletManager.addEventListener('accountChanged', (account) => {
    setState({ walletAccount: account, lockdownActive: null });
    if (getState().mode === 'lockdown') loadPins();
  });

  init(render);

  const state = getState();
  if (state.mode === 'open' && state.multisigAddress) {
    await loadMultisig();
    await loadProposals();
  }
}

boot().catch((err) => {
  console.error('Boot failed:', err);
  showToast('Failed to initialize: ' + err.message, 'error');
});

export { settingsGuard, paginationGuard, proposalActions };
