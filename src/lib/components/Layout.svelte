<script lang="ts">
import { app, onBackToSquads, onChangeMultisig, onLoadMore } from '../app.svelte'
import { sanitize } from '../format'
import { hasAnyPins } from '../pins.js'
import { shortenAddress } from '../squads.js'
import AddressBar from './AddressBar.svelte'
import Logo from './Logo.svelte'
import ModeToggle from './ModeToggle.svelte'
import OpenBanner from './OpenBanner.svelte'
import ProposalDetail from './ProposalDetail.svelte'
import ProposalRow from './ProposalRow.svelte'
import WalletButton from './WalletButton.svelte'

// Lockdown detail: show the pin's nickname (or shortened address) so the
// signer always sees which of their squads they are looking at
const activePin = $derived(
	app.mode === 'lockdown' && app.lockdownActive
		? app.pinned.find((p) => p.multisigAddress === app.lockdownActive)
		: undefined,
)
</script>

<div class="header">
	<div class="header-left">
		<Logo kind="logo" height={20} />
		<span class="logo-text">Verifier</span>
		{#if app.mode === 'lockdown' && app.lockdownActive}
			<span class="header-squad-label" title={app.lockdownActive}
				>{activePin?.label ? sanitize(activePin.label) : shortenAddress(app.lockdownActive)}</span
			>
		{/if}
		{#if app.multisig}
			<div class="header-stats">
				<span class="header-stat">
					<span class="header-stat-label">Threshold</span>
					<span class="header-stat-value">{app.multisig.threshold}/{app.multisig.members.length}</span>
				</span>
				<span class="header-stat-sep"></span>
				<span class="header-stat">
					<span class="header-stat-label">Txns</span>
					<span class="header-stat-value">{String(app.multisig.transactionIndex)}</span>
				</span>
			</div>
		{/if}
	</div>
	<div class="header-right">
		<ModeToggle />
		<WalletButton />
		{#if app.mode !== 'lockdown'}
			<button class="btn btn-ghost btn-sm" title="Switch multisig" onclick={onChangeMultisig}>← Change</button>
		{:else}
			<button class="btn btn-ghost btn-sm" title="Back to your squads" onclick={onBackToSquads}
				>← My squads</button
			>
		{/if}
	</div>
</div>

{#if app.mode === 'open' && hasAnyPins()}
	<OpenBanner />
{/if}

<!-- Open mode only: lockdown must not offer arbitrary address entry -->
{#if app.mode !== 'lockdown'}
	<AddressBar />
{/if}

{#if app.loadingProposals}
	<div class="loading">Loading proposals...</div>
{:else if app.proposals.length === 0 && app.multisig}
	<div class="empty">No proposals found.</div>
{:else if app.proposals.length > 0}
	<div class="section-header">Transactions</div>
	{#each app.proposals as proposal (proposal.index)}
		<ProposalRow {proposal} />
		{#if app.expandedProposal === proposal.index}
			<ProposalDetail {proposal} />
		{/if}
	{/each}

	{#if app.proposalCursor > 1}
		<div class="text-center p-lg">
			<button class="btn" disabled={app.loadingMore} onclick={onLoadMore}
				>{app.loadingMore ? 'Loading...' : 'Load more'}</button
			>
		</div>
	{/if}
{/if}
