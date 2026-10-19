/**
 * Wallet Standard integration — zero dependencies.
 * Inlines the wallet discovery protocol (~20 lines) instead of importing @wallet-standard/app.
 */

// ─── Inline Wallet Standard Discovery ───
// Wallets register via a CustomEvent on window. We listen + dispatch "app-ready".

function getWallets() {
  const registered = [];
  const listeners = { register: [], unregister: [] };

  function addWallets(...wallets) {
    registered.push(...wallets);
    for (const fn of listeners.register) fn(...wallets);
  }

  function removeWallets(...wallets) {
    for (const w of wallets) {
      const idx = registered.indexOf(w);
      if (idx >= 0) registered.splice(idx, 1);
    }
    for (const fn of listeners.unregister) fn(...wallets);
  }

  const api = Object.freeze({ register: addWallets });

  // Listen for future wallet registrations
  window.addEventListener('wallet-standard:register-wallet', (e) => {
    e.detail(api);
  });

  // Tell already-loaded wallets we're ready
  try {
    window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api }));
  } catch { /* ignore in non-browser */ }

  return {
    get: () => [...registered],
    on: (event, fn) => {
      if (listeners[event]) listeners[event].push(fn);
      return () => {
        const arr = listeners[event];
        if (arr) {
          const idx = arr.indexOf(fn);
          if (idx >= 0) arr.splice(idx, 1);
        }
      };
    },
  };
}

// ─── Wallet Manager ───

export function createWalletManager({ chain = 'solana:mainnet' } = {}) {
  const { get, on } = getWallets();

  let connectedWallet = null;
  let connectedAccount = null;
  const eventUnsubscribers = [];
  const listeners = { walletsChanged: [], connectionChanged: [], accountChanged: [] };

  function isSolanaWallet(wallet) {
    return wallet.chains?.some(c => c.startsWith('solana:')) &&
           'standard:connect' in wallet.features;
  }

  function emit(event, ...args) {
    for (const fn of listeners[event] || []) {
      try { fn(...args); } catch (e) { console.error('Event handler error:', e); }
    }
  }

  // Discovery: subscribe FIRST, then snapshot
  const offRegister = on('register', () => emit('walletsChanged', getAvailableWallets()));
  const offUnregister = on('unregister', (...removed) => {
    if (connectedWallet && removed.includes(connectedWallet)) {
      cleanup();
      emit('connectionChanged', null);
    }
    emit('walletsChanged', getAvailableWallets());
  });

  function getAvailableWallets() {
    const seen = new Map();
    for (const w of get()) {
      if (isSolanaWallet(w) && !seen.has(w.name)) {
        seen.set(w.name, w);
      }
    }
    return [...seen.values()];
  }

  async function connect(wallet, { silent = false, timeoutMs = 60000 } = {}) {
    const connectFeature = wallet.features['standard:connect'];
    if (!connectFeature) throw new Error(`${wallet.name} missing standard:connect`);

    if (!wallet.chains.includes(chain)) {
      throw new Error(`${wallet.name} does not support ${chain}`);
    }

    let timeoutId;
    const connectPromise = connectFeature.connect(silent ? { silent: true } : undefined);
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Connect timed out')), timeoutMs);
    });

    let result;
    try {
      result = await Promise.race([connectPromise, timeoutPromise]);
    } finally {
      clearTimeout(timeoutId);
    }
    const { accounts } = result;

    const validAccount = (accounts.length > 0 ? accounts : wallet.accounts)
      .find(a => a.chains.includes(chain));

    if (!validAccount) {
      throw new Error('No account available for ' + chain);
    }

    connectedWallet = wallet;
    connectedAccount = validAccount;

    const eventsFeature = wallet.features['standard:events'];
    if (eventsFeature) {
      const unsub = eventsFeature.on('change', (props) => {
        if (props.accounts) {
          const newAccount = props.accounts.find(a => a.chains.includes(chain));
          if (newAccount && newAccount.address !== connectedAccount?.address) {
            connectedAccount = newAccount;
            emit('accountChanged', newAccount);
          }
        }
      });
      eventUnsubscribers.push(unsub);
    }

    emit('connectionChanged', { wallet, account: validAccount });
    return validAccount;
  }

  async function disconnect() {
    if (!connectedWallet) return;
    const wallet = connectedWallet;
    cleanup();

    const disconnectFeature = wallet.features['standard:disconnect'];
    if (disconnectFeature) {
      try { await disconnectFeature.disconnect(); } catch { /* ignore */ }
    }
    emit('connectionChanged', null);
  }

  function cleanup() {
    for (const unsub of eventUnsubscribers) unsub();
    eventUnsubscribers.length = 0;
    connectedWallet = null;
    connectedAccount = null;
  }

  async function signAndSendTransaction(transactionBytes, options = {}) {
    if (!connectedWallet || !connectedAccount) throw new Error('Not connected');

    const feature = connectedWallet.features['solana:signAndSendTransaction'];
    if (!feature) throw new Error(`${connectedWallet.name} does not support signAndSendTransaction`);

    const [result] = await feature.signAndSendTransaction({
      account: connectedAccount,
      transaction: transactionBytes,
      chain,
      options: {
        commitment: options.commitment || 'confirmed',
        skipPreflight: options.skipPreflight || false,
        maxRetries: options.maxRetries ?? 3,
      },
    });

    return result.signature;
  }

  function getAccount() { return connectedAccount; }
  function getWalletInfo() { return connectedWallet; }
  function isConnected() { return connectedWallet !== null && connectedAccount !== null; }

  function addEventListener(event, fn) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(fn);
    return () => { listeners[event] = listeners[event].filter(f => f !== fn); };
  }

  function destroy() {
    cleanup();
    offRegister();
    offUnregister();
  }

  return {
    getAvailableWallets,
    connect,
    disconnect,
    signAndSendTransaction,
    getAccount,
    getWalletInfo,
    isConnected,
    addEventListener,
    destroy,
  };
}
