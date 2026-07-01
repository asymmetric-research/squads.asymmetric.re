/**
 * UI Layout — Quiet Dark redesign.
 * All rendering via el() — no innerHTML.
 */
import { el, addrEl, formatSol, formatTimestamp, statusBadge, sanitize, fragment } from './ui-helpers.js';
import { shortenAddress, toHex, getTransactionPda, encodeBase58 } from './squads.js';
import { getState, setState, getExplorerUrl } from './state.js';
import { decodeInstruction, KNOWN_PROGRAMS } from './decode.js';
import { isValidBase58 } from './squads.js';

// Toast system
const toastContainer = (() => {
  const c = el('div', { className: 'toast-container' });
  document.body.appendChild(c);
  return c;
})();

export function showToast(message, type = 'info') {
  const toast = el('div', { className: `toast toast-${type}` }, sanitize(message));
  toastContainer.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 5000);
}

// ─── Setup View ───

export function renderSetup(onComplete) {
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const wrapper = el('div', { className: 'setup-wrapper' });


  // Main content
  const main = el('div', { className: 'setup-main' });

  // Left: branding + about
  const left = el('div', { className: 'setup-left' });

  const brandBlock = el('div', { className: 'setup-brand' });
  brandBlock.appendChild(el('img', {
    src: isDark ? 'logotype-white.svg' : 'logotype-black.svg',
    height: '28',
    alt: 'Squads',
  }));
  brandBlock.appendChild(el('span', { className: 'setup-brand-badge' }, 'Verifier'));
  left.appendChild(brandBlock);

  left.appendChild(el('p', { className: 'setup-about' },
    'An independently hosted fork of the Squads multisig verifier, operated by ',
    el('a', { href: 'https://asymmetric.re', target: '_blank', rel: 'noopener noreferrer' }, 'Asymmetric Research'),
    ' as part of the ',
    el('a', { href: 'https://stride.asymmetric.re/', target: '_blank', rel: 'noopener noreferrer' }, 'STRIDE'),
    ' initiative.',
  ));
  left.appendChild(el('p', { className: 'setup-about' },
    'Independent hosting reduces single-point supply chain risk for multisig operators.',
  ));

  const metaGrid = el('div', { className: 'setup-meta' });
  const metaItems = [
    ['Pinned RPC', 'Triton One', 'https://triton.one'],
    ['Pinned Explorer', 'Solscan', 'https://solscan.io'],
    ['Upstream', 'Solana-Multisig-Tools/multisig-verifier', 'https://github.com/Solana-Multisig-Tools/multisig-verifier'],
    ['This fork', 'asymmetric-research/multisig-verifier', 'https://github.com/asymmetric-research/multisig-verifier'],
  ];
  for (const [label, text, href] of metaItems) {
    metaGrid.appendChild(el('span', { className: 'setup-meta-label' }, label));
    metaGrid.appendChild(el('a', { href, target: '_blank', rel: 'noopener noreferrer', className: 'setup-meta-value' }, text));
  }
  left.appendChild(metaGrid);

  main.appendChild(left);

  // Right: form
  const right = el('div', { className: 'setup-right' });
  const card = el('div', { className: 'setup-card' });

  card.appendChild(el('h2', {}, 'Connect to your multisig'));
  card.appendChild(el('p', {}, 'Enter your multisig address to get started.'));

  const addressField = el('div', { className: 'field' });
  addressField.appendChild(el('label', {}, 'Multisig Address'));
  const addressInput = el('input', { type: 'text', placeholder: 'Enter base58 address...' });
  addressField.appendChild(addressInput);

  const errorMsg = el('p', { className: 'error-inline' });

  const submitBtn = el('button', {
    className: 'btn btn-primary mt-md',
    onclick: () => {
      const addr = addressInput.value.trim();
      if (!isValidBase58(addr)) {
        errorMsg.textContent = 'Invalid base58 address (must be 32 bytes)';
        errorMsg.className = 'error-inline visible';
        return;
      }
      onComplete(addr);
    },
  }, 'Continue');

  card.appendChild(addressField);
  card.appendChild(errorMsg);
  card.appendChild(submitBtn);
  right.appendChild(card);
  main.appendChild(right);

  wrapper.appendChild(main);

  return wrapper;
}

// ─── Settings Modal ───

function renderSettingsModal(state) {
  const overlay = el('div', { className: 'modal-overlay', onclick: () => setState({ showSettings: false }) });
  const modal = el('div', { className: 'modal', onclick: (e) => e.stopPropagation() });

  modal.appendChild(el('h3', {}, 'Settings'));

  const actions = el('div', { className: 'flex gap-sm mt-md' });
  actions.appendChild(el('button', {
    className: 'btn btn-primary',
    onclick: () => {
      setState({ showSettings: false });
    },
  }, 'Close'));
  actions.appendChild(el('button', {
    className: 'btn',
    onclick: () => setState({ showSettings: false }),
  }, 'Cancel'));
  modal.appendChild(actions);

  overlay.appendChild(modal);
  return overlay;
}

// ─── Wallet Picker Modal ───

function renderWalletPicker(walletManager) {
  const overlay = el('div', { className: 'modal-overlay', onclick: () => setState({ showWalletPicker: false }) });
  const modal = el('div', { className: 'modal', onclick: (e) => e.stopPropagation() });

  modal.appendChild(el('h3', {}, 'Connect Wallet'));

  const wallets = walletManager.getAvailableWallets();

  if (wallets.length === 0) {
    modal.appendChild(el('p', { className: 'text-muted' }, 'No Solana wallet detected. Install Phantom, Solflare, or Backpack.'));
  } else {
    const list = el('div', { className: 'wallet-list' });
    for (const wallet of wallets) {
      const btn = el('button', {
        className: 'wallet-option',
        onclick: async () => {
          setState({ showWalletPicker: false });
          try {
            const account = await walletManager.connect(wallet);
            setState({ walletAccount: account, connectedWallet: wallet });
          } catch (err) {
            if (err?.code !== 4001) {
              showToast('Connection failed: ' + (err.message || 'Unknown error'), 'error');
            }
          }
        },
      });

      if (wallet.icon) {
        const img = el('img', { src: wallet.icon, width: '28', height: '28' });
        btn.appendChild(img);
      }
      btn.appendChild(el('span', {}, wallet.name));
      list.appendChild(btn);
    }
    modal.appendChild(list);
  }

  overlay.appendChild(modal);
  return overlay;
}

// ─── Instruction Detail Rendering ───

function renderInstruction(ix, txMessage, ixIndex) {
  const programId = txMessage.accountKeys[ix.programIdIndex];
  const decoded = decodeInstruction(programId, ix.data, txMessage.accountKeys, ix.accountIndexes);

  const card = el('div', { className: 'ix-card ix-collapsed' });

  // Clickable summary header
  const knownClass = decoded.type === 'decoded' ? 'known' : (decoded.isKnown ? 'known' : 'unknown');
  const summary = el('div', { className: 'ix-summary' });

  const summaryLeft = el('div', { className: 'ix-summary-left' });
  summaryLeft.appendChild(el('span', { className: `ix-badge ${knownClass}` }, decoded.type === 'decoded' ? 'Decoded' : (decoded.isKnown ? 'Known' : 'Unknown')));

  const summaryText = el('span', { className: 'ix-summary-text' });
  if (decoded.action) {
    summaryText.appendChild(el('strong', {}, decoded.action + ': '));
    summaryText.appendChild(el('span', {}, decoded.description));
  } else {
    summaryText.appendChild(el('span', {}, `Instruction ${ixIndex + 1}`));
  }
  summaryLeft.appendChild(summaryText);
  summary.appendChild(summaryLeft);

  summary.appendChild(el('span', { className: 'ix-program-name' }, decoded.program));

  const chevron = el('span', { className: 'ix-chevron' }, '\u25B8');
  summary.appendChild(chevron);

  card.appendChild(summary);

  // Expandable detail
  const detail = el('div', { className: 'ix-detail hidden' });

  // Accounts table
  if (ix.accountIndexes.length > 0) {
    const table = el('table', { className: 'accounts-table' });
    const thead = el('tr');
    thead.appendChild(el('th', {}, '#'));
    thead.appendChild(el('th', {}, 'Account'));
    thead.appendChild(el('th', {}, 'Flags'));
    table.appendChild(thead);

    for (let i = 0; i < ix.accountIndexes.length; i++) {
      const accIdx = ix.accountIndexes[i];
      const key = txMessage.accountKeys[accIdx] || '?';
      const isWritable = accIdx < txMessage.numWritableSigners ||
        (accIdx >= txMessage.numSigners && accIdx < txMessage.numSigners + txMessage.numWritableNonSigners);
      const isSigner = accIdx < txMessage.numSigners;

      const row = el('tr');
      row.appendChild(el('td', {}, String(i)));
      row.appendChild(el('td', {}, addrEl(key)));

      const flags = el('td');
      if (isWritable) flags.appendChild(el('span', { className: 'flag flag-w' }, 'W'));
      if (isSigner) flags.appendChild(el('span', { className: 'flag flag-s' }, 'S'));
      row.appendChild(flags);
      table.appendChild(row);
    }
    detail.appendChild(table);
  }

  // Raw hex
  if (ix.data && ix.data.length > 0) {
    detail.appendChild(el('div', { className: 'ix-raw-label' }, 'Raw Data'));
    detail.appendChild(el('div', { className: 'raw-hex' }, toHex(ix.data)));
  }

  card.appendChild(detail);

  // Toggle on click
  summary.onclick = (e) => {
    e.stopPropagation();
    const isCollapsed = card.classList.contains('ix-collapsed');
    card.classList.toggle('ix-collapsed');
    detail.classList.toggle('hidden');
    chevron.textContent = isCollapsed ? '\u25BE' : '\u25B8';
  };

  return card;
}

// ─── Proposal Detail Panel ───

function renderProposalDetail(state, proposalActions, handlers) {
  const tx = state.expandedTransaction;
  const proposal = state.proposals.find(p => p.index === state.expandedProposal);
  const multisig = state.multisig;
  const panel = el('div', { className: 'proposal-detail' });

  if (state.loadingDetail) {
    panel.appendChild(el('div', { className: 'loading' }, 'Loading transaction details...'));
    return panel;
  }

  // ── Approval status card (always on top) ──
  if (proposal && multisig) {
    const approvalCard = el('div', { className: 'detail-card' });

    // Progress header (always visible, clickable to toggle members)
    const threshold = multisig.threshold;
    const approvedCount = proposal.approved.length;

    const progressHeader = el('div', { className: 'approval-header' });
    const progressLeft = el('div', { className: 'approval-header-left' });
    progressLeft.appendChild(el('div', { className: 'detail-card-title' }, 'Approval Progress'));
    const progressRight = el('div', { className: 'approval-header-right' });
    progressRight.appendChild(el('div', { className: 'threshold-count' },
      el('span', { className: 'threshold-current' }, String(approvedCount)),
      el('span', { className: 'threshold-sep' }, '/'),
      el('span', {}, String(threshold)),
    ));
    const approvalChevron = el('span', { className: 'ix-chevron' }, '\u25B8');
    progressRight.appendChild(approvalChevron);
    progressHeader.appendChild(progressLeft);
    progressHeader.appendChild(progressRight);
    approvalCard.appendChild(progressHeader);

    // Progress bar (always visible)
    const progressBar = el('div', { className: 'progress-bar' });
    const progressFill = el('div', {
      className: 'progress-fill' + (approvedCount >= threshold ? ' progress-fill--complete' : ''),
    });
    progressFill.style.width = Math.min(100, (approvedCount / threshold) * 100) + '%';
    progressBar.appendChild(progressFill);
    approvalCard.appendChild(progressBar);

    // Collapsible member grid
    const isExecuted = proposal.status.tag === 5; // Executed
    const memberSection = el('div', { className: 'member-section hidden' });
    const grid = el('div', { className: 'member-grid' });

    // For executed: only show signers. For active: show all members.
    const membersToShow = isExecuted
      ? multisig.members.filter(m => proposal.approved.includes(m.key))
      : multisig.members;

    for (const member of membersToShow) {
      const isApproved = proposal.approved.includes(member.key);
      const isRejected = proposal.rejected.includes(member.key);
      const isCancelled = proposal.cancelled.includes(member.key);
      const isCurrentUser = state.walletAccount?.address === member.key;

      let statusClass = isExecuted ? 'member-approved' : 'member-pending';
      let statusText = isExecuted ? 'Signed' : 'Pending';
      if (!isExecuted && isApproved) { statusClass = 'member-approved'; statusText = 'Approved'; }
      if (isRejected) { statusClass = 'member-rejected'; statusText = 'Rejected'; }
      if (isCancelled) { statusClass = 'member-cancelled'; statusText = 'Cancelled'; }

      const memberCard = el('div', { className: `member-card ${statusClass}` });
      const memberTop = el('div', { className: 'member-card-top' });
      memberTop.appendChild(el('span', { className: 'member-status-dot' }));
      memberTop.appendChild(el('span', { className: 'member-status-text' }, statusText));
      if (isCurrentUser) {
        memberTop.appendChild(el('span', { className: 'badge-you' }, 'you'));
      }
      memberCard.appendChild(memberTop);
      memberCard.appendChild(el('div', { className: 'member-addr' }, addrEl(member.key)));
      grid.appendChild(memberCard);
    }
    memberSection.appendChild(grid);
    approvalCard.appendChild(memberSection);

    // Toggle member grid
    progressHeader.onclick = (e) => {
      e.stopPropagation();
      memberSection.classList.toggle('hidden');
      approvalChevron.textContent = memberSection.classList.contains('hidden') ? '\u25B8' : '\u25BE';
    };

    // Action buttons (inside the approval card)
    if (proposal.status.tag === 1 && state.walletAccount) {
      const member = multisig.members.find(m => m.key === state.walletAccount.address);
      const hasVotePermission = member && (member.permissionsMask & 2);
      const hasApproved = proposal.approved.includes(state.walletAccount.address);
      const hasRejected = proposal.rejected.includes(state.walletAccount.address);

      if (hasVotePermission && !hasApproved && !hasRejected) {
        const actionKey = String(proposal.index);
        const actionState = proposalActions.get(actionKey) || 'idle';
        const isLoading = actionState !== 'idle';

        const actions = el('div', { className: 'actions' });
        actions.appendChild(el('button', {
          className: 'btn btn-primary',
          disabled: isLoading,
          onclick: () => handlers.onApprove(proposal.index),
        }, isLoading ? actionState + '...' : 'Approve'));

        actions.appendChild(el('button', {
          className: 'btn btn-danger',
          disabled: isLoading,
          onclick: () => handlers.onReject(proposal.index),
        }, isLoading ? actionState + '...' : 'Reject'));

        approvalCard.appendChild(actions);
      } else if (hasApproved) {
        approvalCard.appendChild(el('div', { className: 'voted-status voted-approved' }, 'You have approved this proposal'));
      } else if (hasRejected) {
        approvalCard.appendChild(el('div', { className: 'voted-status voted-rejected' }, 'You have rejected this proposal'));
      } else if (!hasVotePermission && member) {
        approvalCard.appendChild(el('div', { className: 'voted-status' }, 'You do not have Vote permission'));
      }
    }

    panel.appendChild(approvalCard);
  }

  if (!tx) {
    panel.appendChild(el('div', { className: 'text-muted' }, 'Transaction data not available.'));
    return panel;
  }

  // ── Transaction details card ──
  const txCard = el('div', { className: 'detail-card' });

  // Config transaction
  if (tx.type === 'config') {
    txCard.appendChild(el('div', { className: 'detail-card-header' },
      el('div', { className: 'detail-card-title' }, 'Configuration Change'),
    ));
    for (const action of tx.actions) {
      const ixCard = el('div', { className: 'ix-card' });
      ixCard.appendChild(el('strong', {}, action.name));
      if (action.member) {
        ixCard.appendChild(el('div', { className: 'mt-sm' },
          el('span', {}, 'Member: '), addrEl(action.member.key),
          el('span', { className: 'text-muted' }, ' (' + action.member.permissions.join(', ') + ')')
        ));
      }
      if (action.threshold !== undefined) {
        ixCard.appendChild(el('div', { className: 'mt-sm' }, `New threshold: ${action.threshold}`));
      }
      if (action.timeLock !== undefined) {
        ixCard.appendChild(el('div', { className: 'mt-sm' }, `Time lock: ${action.timeLock}s`));
      }
      if (action.key) {
        ixCard.appendChild(el('div', { className: 'mt-sm' }, el('span', {}, 'Key: '), addrEl(action.key)));
      }
      txCard.appendChild(ixCard);
    }
    panel.appendChild(txCard);
  }

  // Vault transaction
  if (tx.type === 'vault' && tx.message) {
    txCard.appendChild(el('div', { className: 'detail-card-header' },
      el('div', { className: 'detail-card-title' }, 'Instructions'),
      el('div', { className: 'text-sm text-muted' }, `${tx.message.instructions.length} instruction${tx.message.instructions.length === 1 ? '' : 's'}`),
    ));
    for (let i = 0; i < tx.message.instructions.length; i++) {
      txCard.appendChild(renderInstruction(tx.message.instructions[i], tx.message, i));
    }
    panel.appendChild(txCard);
  }

  // Batch container
  if (tx.type === 'batch') {
    const totalIx = tx.innerTransactions?.reduce((n, t) => n + (t.message?.instructions?.length || 0), 0) || 0;
    txCard.appendChild(el('div', { className: 'detail-card-header' },
      el('div', { className: 'detail-card-title' }, 'Instructions'),
      el('div', { className: 'text-sm text-muted' }, `${totalIx} instruction${totalIx === 1 ? '' : 's'}`),
    ));
    if (tx.innerTransactions && tx.innerTransactions.length > 0) {
      for (const inner of tx.innerTransactions) {
        if (inner.message) {
          for (let i = 0; i < inner.message.instructions.length; i++) {
            txCard.appendChild(renderInstruction(inner.message.instructions[i], inner.message, i));
          }
        }
      }
    } else {
      txCard.appendChild(el('div', { className: 'text-muted p-lg' }, 'No transaction details available.'));
    }
    panel.appendChild(txCard);
  }

  // Unknown transaction type
  if (tx.type === 'unknown') {
    txCard.appendChild(el('div', { className: 'detail-card-header' },
      el('div', { className: 'detail-card-title' }, 'Unknown Transaction'),
    ));
    txCard.appendChild(el('div', { className: 'text-sm text-muted' }, 'Discriminator: ' + tx.discriminator));
    panel.appendChild(txCard);
  }

  return panel;
}

// ─── Main Layout ───

export function renderLayout({ state, walletManager, proposalActions, onConnect, onDisconnect, onSettings, onRefresh, onLoadMore, onExpandProposal, onApprove, onReject }) {
  const container = document.createDocumentFragment();

  // Header (sticky)
  const header = el('div', { className: 'header' });
  const headerLeft = el('div', { className: 'header-left' });
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  headerLeft.appendChild(el('img', {
    src: isDark ? 'logo-white.svg' : 'logo-black.svg',
    height: '20',
    alt: 'Squads',
  }));
  headerLeft.appendChild(el('span', { className: 'logo-text' }, 'Verifier'));

  // Inline stats in header when multisig is loaded
  if (state.multisig) {
    const headerStats = el('div', { className: 'header-stats' });
    headerStats.appendChild(el('span', { className: 'header-stat' },
      el('span', { className: 'header-stat-label' }, 'Threshold'),
      el('span', { className: 'header-stat-value' }, `${state.multisig.threshold}/${state.multisig.members.length}`),
    ));
    headerStats.appendChild(el('span', { className: 'header-stat-sep' }));
    headerStats.appendChild(el('span', { className: 'header-stat' },
      el('span', { className: 'header-stat-label' }, 'Txns'),
      el('span', { className: 'header-stat-value' }, String(state.multisig.transactionIndex)),
    ));
    headerLeft.appendChild(headerStats);
  }

  header.appendChild(headerLeft);

  const headerRight = el('div', { className: 'header-right' });

  if (state.walletAccount) {
    const walletInfo = walletManager.getWalletInfo();
    const walletBtn = el('button', { className: 'btn btn-sm btn-wallet', onclick: onDisconnect });
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

  headerRight.appendChild(el('button', {
    className: 'btn btn-ghost btn-sm',
    onclick: () => setState({ multisigAddress: '', multisig: null, proposals: [] }),
    title: 'Switch multisig',
  }, '\u2190 Change'));
  headerRight.appendChild(el('button', { className: 'btn btn-ghost btn-sm', onclick: onSettings }, '\u2699'));
  header.appendChild(headerRight);
  container.appendChild(header);

  // Address bar (always rendered)
  {
    const addressBar = el('div', { className: 'address-bar' });
    const addrInput = el('input', {
      className: 'address-bar-input',
      type: 'text',
      value: state.multisigAddress,
      placeholder: 'Enter multisig address...',
    });
    const addrHint = el('div', { className: 'address-bar-hint hidden' });
    const actionBtn = el('button', {
      className: 'btn-refresh',
      onclick: onRefresh,
      title: 'Refresh',
    }, '\u21bb');

    function updateAddressBar() {
      const val = addrInput.value.trim();
      const isChanged = val !== state.multisigAddress;
      const isValid = isValidBase58(val);

      if (!isChanged) {
        addrHint.className = 'address-bar-hint hidden';
        actionBtn.textContent = '\u21bb';
        actionBtn.title = 'Refresh';
        actionBtn.onclick = onRefresh;
        addressBar.classList.remove('address-bar--invalid', 'address-bar--changed');
        return;
      }

      if (!isValid) {
        addrHint.textContent = 'Not a valid base58 address';
        addrHint.className = 'address-bar-hint address-bar-hint--error';
        addressBar.classList.add('address-bar--invalid');
        addressBar.classList.remove('address-bar--changed');
        actionBtn.textContent = '\u2192';
        actionBtn.title = 'Switch multisig';
        actionBtn.onclick = () => {};
      } else {
        addrHint.className = 'address-bar-hint hidden';
        addressBar.classList.remove('address-bar--invalid');
        addressBar.classList.add('address-bar--changed');
        actionBtn.textContent = '\u2192';
        actionBtn.title = 'Switch multisig';
        actionBtn.onclick = () => {
          setState({ multisigAddress: val, multisig: null, proposals: [] });
          location.reload();
        };
      }
    }

    addrInput.oninput = updateAddressBar;
    addrInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        const val = addrInput.value.trim();
        if (val !== state.multisigAddress && isValidBase58(val)) {
          setState({ multisigAddress: val, multisig: null, proposals: [] });
          location.reload();
        }
      }
    };

    addressBar.appendChild(addrInput);
    addressBar.appendChild(actionBtn);
    container.appendChild(addressBar);
    container.appendChild(addrHint);
  }


  // Proposal list
  if (state.loadingProposals) {
    container.appendChild(el('div', { className: 'loading' }, 'Loading proposals...'));
  } else if (state.proposals.length === 0 && state.multisig) {
    container.appendChild(el('div', { className: 'empty' }, 'No proposals found.'));
  } else if (state.proposals.length > 0) {
    container.appendChild(el('div', { className: 'section-header' }, 'Transactions'));
    const frag = document.createDocumentFragment();

    for (const proposal of state.proposals) {
      const isExpanded = state.expandedProposal === proposal.index;

      const row = el('div', {
        className: 'proposal-row' + (isExpanded ? ' proposal-row--expanded' : ''),
        onclick: () => onExpandProposal(proposal.index),
      });

      const left = el('div', { className: 'proposal-row-left' });
      left.appendChild(el('span', { className: 'proposal-index' }, '#' + String(proposal.index)));
      left.appendChild(statusBadge(proposal.status));
      row.appendChild(left);

      const right = el('div', { className: 'proposal-approvals' });
      right.appendChild(el('span', {},
        `${proposal.approved.length}/${state.multisig?.threshold || '?'} approved`
      ));
      if (proposal.status.timestamp) {
        right.appendChild(el('span', { className: 'text-xs text-muted' },
          formatTimestamp(proposal.status.timestamp)
        ));
      }
      // Explorer link — only for active proposals, links to transaction PDA
      if (proposal.status.tag === 1) {
        const explorerBtn = el('a', {
          className: 'explorer-link',
          href: '#',
          target: '_blank',
          rel: 'noopener noreferrer',
          title: 'View in explorer',
          onclick: async (e) => {
            e.stopPropagation();
            e.preventDefault();
            const [pdaBytes] = await getTransactionPda(state.multisigAddress, proposal.index);
            const pda = encodeBase58(pdaBytes);
            window.open(getExplorerUrl('account', pda), '_blank');
          },
        }, '\u2197');
        right.appendChild(explorerBtn);
      }
      row.appendChild(right);
      frag.appendChild(row);

      // Expanded detail
      if (isExpanded) {
        frag.appendChild(renderProposalDetail(state, proposalActions, { onApprove, onReject }));
      }
    }

    container.appendChild(frag);

    // Load more
    if (state.proposalCursor > 1) {
      container.appendChild(el('div', { className: 'text-center p-lg' },
        el('button', {
          className: 'btn',
          disabled: state.loadingMore,
          onclick: onLoadMore,
        }, state.loadingMore ? 'Loading...' : 'Load More')
      ));
    }
  }

  // Modals
  if (state.showSettings) {
    container.appendChild(renderSettingsModal(state));
  }

  if (state.showWalletPicker) {
    container.appendChild(renderWalletPicker(walletManager));
  }

  return container;
}
