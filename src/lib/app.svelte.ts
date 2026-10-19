/**
 * App state and the actions that change it. Replaces the old state.js
 * (frozen state + setState → full re-render) and main.js (handlers); the
 * on-chain, RPC and wallet modules underneath are unchanged.
 */
import { SvelteMap } from 'svelte/reactivity'
import {
	addPin,
	findMember,
	getPins,
	hasAnyPins,
	isStickyOpen,
	removePin,
	resolveBootMode,
	setStickyOpen,
} from './pins.js'
import { resolveMultisigAddress } from './resolver.js'
import { fetchMultisig, fetchMultisigBatch, fetchProposalBatch, fetchTransaction } from './rpc.js'
import { shortenAddress } from './squads.js'
import { showToast } from './toasts.svelte'
import { createWalletManager } from './wallet.js'

export type Mode = 'open' | 'lockdown'
export type ActionState = 'idle' | 'refetching' | 'signing' | 'confirming'

// biome-ignore lint/suspicious/noExplicitAny: shapes come from the untyped deserializers in squads.js
type OnChain = any

// resolver.js returns an untagged union; this is the part callers read.
interface Resolved {
	type: string
	multisigAddress: string
	resolvedFrom?: string
	message?: string
}

const resolve = (input: string) => resolveMultisigAddress(app.rpcUrl, input) as Promise<Resolved>

export interface Pinned {
	multisigAddress: string
	label: string
	pinnedAt: number
	multisig: OnChain | null
	error: string | null
	membership: OnChain | null
}

// Generation guards for async race condition protection
function createGuard() {
	let current = 0
	return {
		next: () => ++current,
		isStale: (captured: number) => captured !== current,
		get current() {
			return current
		},
	}
}

const settingsGuard = createGuard()
const paginationGuard = createGuard()
const expandGuard = createGuard()

class AppState {
	readonly rpcUrl: string = __RPC_URL__ || 'https://api.mainnet-beta.solana.com'

	multisigAddress = $state('')
	mode: Mode = $state('open')
	stickyOpen = $state(false)

	// Lockdown mode
	pinned: Pinned[] = $state.raw([])
	loadingPins = $state(false)
	pinsError: string | null = $state(null)
	lockdownActive: string | null = $state(null)

	// Runtime state (never persisted)
	multisig: OnChain | null = $state.raw(null)
	proposals: OnChain[] = $state.raw([])
	proposalCursor = $state(0)
	expandedProposal: number | null = $state(null)
	expandedTransaction: OnChain | null = $state.raw(null)
	walletAccount: OnChain | null = $state.raw(null)
	connectedWallet: OnChain | null = $state.raw(null)
	loading = $state(false)
	loadingProposals = $state(false)
	loadingMore = $state(false)
	loadingDetail = $state(false)
	error: string | null = $state(null)
	lastUpdated: Date | null = $state(null)
	showWalletPicker = $state(false)

	/** Bumped when a local program label changes, so decoded instructions re-resolve names. */
	labelsVersion = $state(0)

	proposalActions = new SvelteMap<string, ActionState>()

	// biome-ignore lint/suspicious/noExplicitAny: wallet.js is untyped
	wallet: any = null
}

export const app = new AppState()

// Persisted fields: written only when set, as the old setState() did.
export function setMultisigAddress(address: string) {
	app.multisigAddress = address
	localStorage.setItem('multisigAddress', address)
}

function setMode(mode: Mode) {
	app.mode = mode
	// Session-scoped: an explicit mode switch holds for this tab only, so
	// lockdown re-asserts on the next visit unless stickyOpen is set.
	sessionStorage.setItem('modeOverride', mode)
}

export function onStickyOpenChange(checked: boolean) {
	app.stickyOpen = checked
	setStickyOpen(checked)
}

const anyActionInProgress = () => [...app.proposalActions.values()].some((s) => s !== 'idle')

// ─── Open mode ───

// A re-mounted setup card has a fresh (enabled) button, so the per-card
// disable alone can't prevent a second concurrent resolution.
let setupResolving = false

export async function onSetupComplete(address: string) {
	if (setupResolving) return
	setupResolving = true
	try {
		const resolved = await resolve(address)
		if (resolved.type === 'multisig') {
			if (resolved.resolvedFrom) {
				showToast(
					resolved.message || `Resolved to multisig: ${resolved.multisigAddress.slice(0, 8)}...`,
					'info',
				)
			}
			setMultisigAddress(resolved.multisigAddress)
			await loadMultisig()
			await loadProposals()
		} else {
			showToast(resolved.message || 'Not a Squads v4 multisig.', 'error')
		}
	} catch (err) {
		showToast(`Failed to resolve address: ${(err as Error).message}`, 'error')
	} finally {
		setupResolving = false
	}
}

export async function onConnect(wallet: unknown) {
	app.showWalletPicker = false
	try {
		const account = await app.wallet.connect(wallet)
		app.walletAccount = account
		app.connectedWallet = wallet
	} catch (err) {
		const e = err as { code?: number; message?: string }
		if (e?.code !== 4001) showToast(`Connection failed: ${e.message || 'Unknown error'}`, 'error')
	}
}

export async function onDisconnect() {
	await app.wallet.disconnect()
	app.walletAccount = null
	app.connectedWallet = null
}

export async function onRefresh() {
	settingsGuard.next()
	app.lastUpdated = null
	await loadMultisig()
	await loadProposals()
}

export function onChangeMultisig() {
	setMultisigAddress('')
	app.multisig = null
	app.proposals = []
}

export async function onLoadMore() {
	if (app.loadingMore) return
	const nextEnd = app.proposalCursor - 1
	const nextStart = Math.max(1, nextEnd - 19)
	if (nextEnd < 1) return

	app.loadingMore = true
	const gen = paginationGuard.next()
	try {
		const batch = await fetchProposalBatch(app.rpcUrl, app.multisigAddress, nextStart, nextEnd)
		if (paginationGuard.isStale(gen)) return
		app.proposals = [...app.proposals, ...batch]
		app.proposalCursor = nextStart
	} catch (err) {
		if (paginationGuard.isStale(gen)) return
		showToast(`Failed to load more: ${(err as Error).message}`, 'error')
	} finally {
		app.loadingMore = false
	}
}

export async function onExpandProposal(index: number) {
	if (app.expandedProposal === index) {
		app.expandedProposal = null
		app.expandedTransaction = null
		return
	}

	app.expandedProposal = index
	app.expandedTransaction = null
	app.loadingDetail = true
	const gen = expandGuard.next()
	try {
		const tx = await fetchTransaction(app.rpcUrl, app.multisigAddress, index)
		if (expandGuard.isStale(gen)) return
		app.expandedTransaction = tx
		app.loadingDetail = false
	} catch (err) {
		if (expandGuard.isStale(gen)) return
		showToast(`Failed to load transaction: ${(err as Error).message}`, 'error')
		app.loadingDetail = false
	}
}

export const onApprove = (index: number) => executeVote(index, true)
export const onReject = (index: number) => executeVote(index, false)

async function executeVote(index: number, approve: boolean) {
	const key = String(index)
	const current = app.proposalActions.get(key)
	if (current && current !== 'idle') {
		showToast('An action is already in progress for this proposal.', 'info')
		return
	}
	if (!app.wallet?.isConnected()) {
		showToast('Please connect your wallet first.', 'error')
		return
	}

	const { rpcUrl, multisigAddress } = app
	app.proposalActions.set(key, 'refetching')
	const gen = settingsGuard.next()

	try {
		// Dynamic import to keep initial load light
		const { buildVoteTransaction } = await import('./actions.js')
		if (settingsGuard.isStale(gen)) return

		// Re-fetch proposal to check for stale state
		const [proposal] = await fetchProposalBatch(rpcUrl, multisigAddress, index, index)
		if (settingsGuard.isStale(gen)) return
		if (proposal?.status.tag !== 1) {
			showToast(
				`Proposal is no longer active (status: ${proposal?.status.name || 'unknown'})`,
				'error',
			)
			return
		}

		app.proposalActions.set(key, 'signing')
		const account = app.wallet.getAccount()
		const txBytes = await buildVoteTransaction(
			multisigAddress,
			account.address,
			index,
			approve,
			rpcUrl,
		)
		await app.wallet.signAndSendTransaction(txBytes)
		if (settingsGuard.isStale(gen)) return

		app.proposalActions.set(key, 'confirming')
		showToast('Transaction sent! Confirming...', 'info')

		// Refresh the proposal after a short delay
		await new Promise((r) => setTimeout(r, 2000))
		if (settingsGuard.isStale(gen)) return

		await loadProposals()
		showToast(`${approve ? 'Approved' : 'Rejected'} proposal #${index}`, 'success')
	} catch (err) {
		const e = err as { code?: number; message?: string }
		// User cancelled — silently reset
		if (!(e?.code === 4001 || (e?.message || '').toLowerCase().includes('user rejected'))) {
			showToast(`Vote failed: ${e.message || 'Unknown error'}`, 'error')
		}
	} finally {
		app.proposalActions.set(key, 'idle')
	}
}

async function loadMultisig() {
	if (!app.multisigAddress) return
	app.loading = true
	app.error = null
	const gen = settingsGuard.current
	try {
		const multisig = await fetchMultisig(app.rpcUrl, app.multisigAddress)
		if (settingsGuard.isStale(gen)) return
		app.multisig = multisig
		app.loading = false
	} catch (err) {
		if (settingsGuard.isStale(gen)) return
		const message = `Failed to load multisig: ${(err as Error).message}`
		app.loading = false
		app.error = message
		app.multisig = null
		app.proposals = []
		showToast(message, 'error')
	}
}

async function loadProposals() {
	if (!app.multisig) return
	app.loadingProposals = true
	const gen = paginationGuard.next()
	try {
		const txIndex = Number(app.multisig.transactionIndex)
		const start = Math.max(1, txIndex - 19)
		const proposals = await fetchProposalBatch(app.rpcUrl, app.multisigAddress, start, txIndex)
		if (paginationGuard.isStale(gen)) return

		for (const p of proposals) {
			if (!app.proposalActions.has(String(p.index)))
				app.proposalActions.set(String(p.index), 'idle')
		}
		app.proposals = proposals
		app.proposalCursor = start
		app.loadingProposals = false
		app.lastUpdated = new Date()
	} catch (err) {
		if (paginationGuard.isStale(gen)) return
		showToast(`Failed to load proposals: ${(err as Error).message}`, 'error')
		app.loadingProposals = false
	}
}

// ─── Lockdown mode ───

export async function loadPins() {
	const wallet = app.walletAccount?.address
	if (!wallet) return

	const pins = getPins(wallet)
	app.loadingPins = true
	app.pinsError = null
	try {
		const results = await fetchMultisigBatch(
			app.rpcUrl,
			pins.map((p: Pinned) => p.multisigAddress),
		)
		// Wallet may have changed while fetching — results belong to `wallet`
		if (app.walletAccount?.address !== wallet) return

		app.pinned = pins.map((p: Pinned, i: number) => ({
			...p,
			multisig: results[i].multisig,
			error: results[i].error,
			// Re-verified on every load: the on-chain roster is the source of truth
			membership: results[i].multisig ? findMember(results[i].multisig, wallet) : null,
		}))
		app.loadingPins = false
	} catch (err) {
		if (app.walletAccount?.address !== wallet) return
		app.loadingPins = false
		app.pinsError = `Failed to load squads: ${(err as Error).message}`
	}
}

export async function onAddPin(input: string, label: string): Promise<boolean> {
	const wallet = app.walletAccount?.address
	if (!wallet) {
		showToast('Connect your wallet first.', 'error')
		return false
	}

	// Never pin unverified: resolve, fetch, and membership-check must all
	// succeed before the pin is written.
	const resolved = await resolve(input)
	if (resolved.type !== 'multisig') {
		showToast(resolved.message || 'Not a Squads v4 multisig.', 'error')
		return false
	}

	const multisig = await fetchMultisig(app.rpcUrl, resolved.multisigAddress)
	if (!findMember(multisig, wallet)) {
		showToast(
			`Refused: wallet ${shortenAddress(wallet)} is not a member of this multisig.`,
			'error',
		)
		return false
	}

	const { persisted } = addPin(wallet, { multisigAddress: resolved.multisigAddress, label })
	if (!persisted) {
		showToast('Pinned for this session, but saving to browser storage failed.', 'error')
	} else if (resolved.resolvedFrom) {
		showToast(`Resolved to multisig: ${resolved.multisigAddress.slice(0, 8)}…`, 'info')
	}
	await loadPins()
	return true
}

export function onUnpin(multisigAddress: string) {
	const wallet = app.walletAccount?.address
	if (!wallet) return
	removePin(wallet, multisigAddress)
	loadPins()
}

export async function onOpenSquad(multisigAddress: string) {
	app.lockdownActive = multisigAddress
	setMultisigAddress(multisigAddress)
	app.multisig = null
	app.proposals = []
	app.expandedProposal = null
	app.expandedTransaction = null
	await loadMultisig()
	await loadProposals()
}

export function onBackToSquads() {
	settingsGuard.next()
	app.lockdownActive = null
	app.multisig = null
	app.proposals = []
	app.expandedProposal = null
	app.expandedTransaction = null
	app.error = null
	loadPins()
}

export function onSwitchMode(mode: Mode) {
	settingsGuard.next()
	setMode(mode)
	app.lockdownActive = null
	app.expandedProposal = null
	app.expandedTransaction = null
	if (mode === 'lockdown' && app.walletAccount) loadPins()
}

// ─── Boot ───

export async function boot() {
	// Clear any previously stored user-configurable values
	localStorage.removeItem('rpcUrl')
	localStorage.removeItem('explorerUrl')

	app.multisigAddress = localStorage.getItem('multisigAddress') || ''
	app.stickyOpen = isStickyOpen()
	app.mode = resolveBootMode({
		hasPins: hasAnyPins(),
		stickyOpen: app.stickyOpen,
		sessionMode: sessionStorage.getItem('modeOverride'),
	})

	const wallet = createWalletManager({ chain: 'solana:mainnet' })
	app.wallet = wallet

	wallet.addEventListener(
		'connectionChanged',
		(info: { account: unknown; wallet: unknown } | null) => {
			if (info) {
				app.walletAccount = info.account
				app.connectedWallet = info.wallet
				if (app.mode === 'lockdown') loadPins()
			} else {
				// Wallet disconnected — cancel in-flight actions
				for (const key of app.proposalActions.keys()) app.proposalActions.set(key, 'idle')
				settingsGuard.next()
				app.walletAccount = null
				app.connectedWallet = null
				app.pinned = []
				app.lockdownActive = null
			}
		},
	)

	wallet.addEventListener('accountChanged', (account: unknown) => {
		app.walletAccount = account
		app.lockdownActive = null
		if (app.mode === 'lockdown') loadPins()
	})

	// Tab visibility: refresh on return after 30s
	let lastVisibleTimestamp = Date.now()
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') {
			if (Date.now() - lastVisibleTimestamp > 30_000 && !anyActionInProgress()) {
				settingsGuard.next()
				loadProposals()
			}
		} else {
			lastVisibleTimestamp = Date.now()
		}
	})

	// Cross-tab localStorage detection
	window.addEventListener('storage', (e) => {
		if (e.key && ['multisigAddress', 'pinnedSquads'].includes(e.key)) {
			if (anyActionInProgress()) return
			showToast('Settings changed in another tab. Reloading...', 'info')
			setTimeout(() => location.reload(), 1500)
		}
	})

	if (app.mode === 'open' && app.multisigAddress) {
		await loadMultisig()
		await loadProposals()
	}
}
