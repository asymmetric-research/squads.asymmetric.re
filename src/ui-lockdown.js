/**
 * Lockdown mode UI — connect prompt, pinned-squad grid, add-squad flow,
 * mode toggle, and the open-mode warning banner.
 * Must not import from ui-layout.js (ui-layout imports this module).
 */
import { el, sanitize, addrEl } from './ui-helpers.js';
import { setState } from './state.js';
import { isValidBase58, shortenAddress } from './squads.js';

// ─── Mode toggle (shared with open-mode header) ───

export function renderModeToggle(state, onSwitchMode) {
  const toggle = el('div', { className: 'mode-toggle', role: 'group', 'aria-label': 'Interface mode' });
  toggle.appendChild(el('button', {
    className: 'mode-toggle-btn' + (state.mode === 'lockdown' ? ' mode-toggle-btn--active' : ''),
    onclick: () => { if (state.mode !== 'lockdown') onSwitchMode('lockdown'); },
    title: 'Only your pinned, membership-verified squads',
  }, 'Lockdown'));
  toggle.appendChild(el('button', {
    className: 'mode-toggle-btn mode-toggle-btn--open' + (state.mode === 'open' ? ' mode-toggle-btn--active' : ''),
    onclick: () => { if (state.mode !== 'open') onSwitchMode('open'); },
    title: 'View any multisig address (unverified)',
  }, 'Open'));
  return toggle;
}

// ─── Open-mode warning banner ───

export function renderOpenBanner(state, onStickyOpenChange) {
  const banner = el('div', { className: 'open-banner' });
  banner.appendChild(el('span', { className: 'open-banner-text' },
    'Open mode — addresses here are not membership-verified.'));
  const stickyLabel = el('label', { className: 'open-banner-sticky' });
  stickyLabel.appendChild(el('input', {
    type: 'checkbox',
    checked: state.stickyOpen,
    onchange: (e) => onStickyOpenChange(e.target.checked),
  }));
  stickyLabel.appendChild(el('span', {}, 'Stay in open mode'));
  banner.appendChild(stickyLabel);
  return banner;
}

// ─── Lockdown home ───

export function renderLockdownHome({ state, walletManager, onAddPin, onUnpin, onOpenSquad, onRetryPins, onSwitchMode }) {
  const wrapper = el('div', { className: 'lockdown-wrapper' });

  // Header
  const header = el('div', { className: 'header' });
  const headerLeft = el('div', { className: 'header-left' });
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  headerLeft.appendChild(el('img', {
    src: isDark ? 'logo-white.svg' : 'logo-black.svg',
    height: '20',
    alt: 'Squads',
  }));
  headerLeft.appendChild(el('span', { className: 'logo-text' }, 'Verifier'));
  headerLeft.appendChild(el('span', { className: 'lockdown-badge' }, 'Lockdown'));
  header.appendChild(headerLeft);

  const headerRight = el('div', { className: 'header-right' });
  headerRight.appendChild(renderModeToggle(state, onSwitchMode));
  if (state.walletAccount) {
    const walletInfo = walletManager.getWalletInfo();
    const walletBtn = el('button', {
      className: 'btn btn-sm btn-wallet',
      onclick: () => walletManager.disconnect(),
    });
    if (walletInfo?.icon) {
      walletBtn.appendChild(el('img', { src: walletInfo.icon, width: '16', height: '16', className: 'wallet-icon' }));
    }
    walletBtn.appendChild(el('span', {}, shortenAddress(state.walletAccount.address)));
    headerRight.appendChild(walletBtn);
  } else {
    headerRight.appendChild(el('button', {
      className: 'btn btn-primary btn-sm',
      onclick: () => setState({ showWalletPicker: true }),
    }, 'Connect'));
  }
  header.appendChild(headerRight);
  wrapper.appendChild(header);

  // Pre-connect: the pin list is keyed by wallet, so nothing renders before connect
  if (!state.walletAccount) {
    const gate = el('div', { className: 'lockdown-gate' });
    gate.appendChild(el('h2', {}, 'Your squads, verified'));
    gate.appendChild(el('p', { className: 'text-muted' },
      'Connect your wallet to see your pinned squads. Every squad is verified against its on-chain member roster.'));
    gate.appendChild(el('button', {
      className: 'btn btn-primary mt-md',
      onclick: () => setState({ showWalletPicker: true }),
    }, 'Connect wallet'));
    wrapper.appendChild(gate);
    return wrapper;
  }

  // List states
  if (state.loadingPins) {
    wrapper.appendChild(el('div', { className: 'loading' }, 'Verifying your squads on-chain...'));
    return wrapper;
  }

  if (state.pinsError) {
    const errBox = el('div', { className: 'lockdown-error' });
    errBox.appendChild(el('span', {}, sanitize(state.pinsError)));
    errBox.appendChild(el('button', { className: 'btn btn-sm', onclick: onRetryPins }, 'Retry'));
    wrapper.appendChild(errBox);
    return wrapper;
  }

  wrapper.appendChild(el('div', { className: 'section-header' }, 'My squads'));

  if (state.pinned.length === 0) {
    wrapper.appendChild(el('div', { className: 'empty' },
      'No squads pinned yet for this wallet. Add one below — it will only pin if your wallet is a member on-chain.'));
  } else {
    const grid = el('div', { className: 'squad-grid' });
    for (const pin of state.pinned) {
      grid.appendChild(renderSquadCard(pin, { onOpenSquad, onUnpin, onRetryPins }));
    }
    wrapper.appendChild(grid);
  }

  wrapper.appendChild(renderAddSquadForm(state, onAddPin));
  return wrapper;
}

function renderSquadCard(pin, { onOpenSquad, onUnpin, onRetryPins }) {
  const isMemberOk = !!pin.membership;
  const card = el('div', {
    className: 'squad-card' + (pin.error ? ' squad-card--error' : '') + (!pin.error && !isMemberOk ? ' squad-card--revoked' : ''),
  });

  const top = el('div', { className: 'squad-card-top' });
  top.appendChild(el('span', { className: 'squad-card-label' },
    sanitize(pin.label) || shortenAddress(pin.multisigAddress)));
  const unpinBtn = el('button', {
    className: 'btn btn-ghost btn-sm squad-unpin',
    title: 'Unpin this squad',
    onclick: (e) => { e.stopPropagation(); onUnpin(pin.multisigAddress); },
  }, 'Unpin');
  top.appendChild(unpinBtn);
  card.appendChild(top);

  card.appendChild(el('div', { className: 'squad-card-addr' }, addrEl(pin.multisigAddress)));

  if (pin.error) {
    // Failed cards are never silently dropped
    card.appendChild(el('div', { className: 'squad-card-status squad-card-status--error' }, sanitize(pin.error)));
    card.appendChild(el('button', { className: 'btn btn-sm mt-sm', onclick: (e) => { e.stopPropagation(); onRetryPins(); } }, 'Retry'));
    return card;
  }

  const stats = el('div', { className: 'squad-card-stats' });
  stats.appendChild(el('span', {}, `Threshold ${pin.multisig.threshold}/${pin.multisig.members.length}`));
  stats.appendChild(el('span', {}, `${pin.multisig.transactionIndex} txns`));
  card.appendChild(stats);

  if (isMemberOk) {
    card.appendChild(el('div', { className: 'squad-card-status squad-card-status--member' },
      'Member · ' + (pin.membership.permissions.join(', ') || 'no permissions')));
    card.onclick = () => onOpenSquad(pin.multisigAddress);
    card.classList.add('squad-card--clickable');
  } else {
    // Roster changed since pinning: keep visible + badged, actions locked
    card.appendChild(el('div', { className: 'squad-card-status squad-card-status--revoked' },
      'No longer a member'));
  }
  return card;
}

function renderAddSquadForm(state, onAddPin) {
  const form = el('div', { className: 'add-squad' });
  form.appendChild(el('div', { className: 'section-header' }, 'Add a squad'));

  const row = el('div', { className: 'add-squad-row' });
  const addrInput = el('input', {
    className: 'add-squad-input',
    type: 'text',
    placeholder: 'Multisig, vault, or proposal address...',
  });
  const labelInput = el('input', {
    className: 'add-squad-label',
    type: 'text',
    maxlength: '32',
    placeholder: 'Nickname (optional)',
  });
  const errorMsg = el('p', { className: 'error-inline' });
  const addBtn = el('button', { className: 'btn btn-primary' }, 'Verify & pin');

  let adding = false;
  addBtn.onclick = async () => {
    if (adding) return;
    const addr = addrInput.value.trim();
    if (!isValidBase58(addr)) {
      errorMsg.textContent = 'Not a valid base58 address';
      errorMsg.className = 'error-inline visible';
      return;
    }
    errorMsg.className = 'error-inline';
    adding = true;
    addBtn.disabled = true;
    addBtn.textContent = 'Verifying on-chain...';
    try {
      await onAddPin(addr, labelInput.value.trim());
      // Success re-renders the whole view; nothing to reset here.
    } catch (err) {
      errorMsg.textContent = 'Verification failed: ' + err.message;
      errorMsg.className = 'error-inline visible';
    } finally {
      adding = false;
      if (document.contains(addBtn)) {
        addBtn.disabled = false;
        addBtn.textContent = 'Verify & pin';
      }
    }
  };

  addrInput.onkeydown = (e) => { if (e.key === 'Enter') addBtn.onclick(); };

  row.appendChild(addrInput);
  row.appendChild(labelInput);
  row.appendChild(addBtn);
  form.appendChild(row);
  form.appendChild(errorMsg);
  form.appendChild(el('p', { className: 'text-xs text-muted mt-sm' },
    'Pinning is refused unless your connected wallet is a member of the multisig on-chain.'));
  return form;
}
