<script lang="ts">
import { app, loadPins } from '../app.svelte'
import AddSquadForm from './AddSquadForm.svelte'
import Logo from './Logo.svelte'
import ModeToggle from './ModeToggle.svelte'
import SquadCard from './SquadCard.svelte'
import WalletButton from './WalletButton.svelte'
</script>

<div class="lockdown-wrapper">
	<div class="header">
		<div class="header-left">
			<Logo kind="logo" height={20} />
			<span class="logo-text">Verifier</span>
			<span class="lockdown-badge">Lockdown</span>
		</div>
		<div class="header-right">
			<ModeToggle />
			<WalletButton />
		</div>
	</div>

	{#if !app.walletAccount}
		<!-- The pin list is keyed by wallet, so nothing renders before connect -->
		<div class="lockdown-gate">
			<h2>Your squads, verified</h2>
			<p class="text-muted">
				Connect your wallet to see your pinned squads. Every squad is verified against its on-chain member
				roster.
			</p>
			<button class="btn btn-primary mt-md" onclick={() => (app.showWalletPicker = true)}
				>Connect wallet</button
			>
		</div>
	{:else if app.loadingPins}
		<div class="loading">Verifying your squads on-chain...</div>
	{:else if app.pinsError}
		<div class="lockdown-error">
			<span>{app.pinsError}</span>
			<button class="btn btn-sm" onclick={loadPins}>Retry</button>
		</div>
	{:else}
		<div class="section-header">My squads</div>
		{#if app.pinned.length === 0}
			<div class="empty">
				No squads pinned yet for this wallet. Add one below — it will only pin if your wallet is a member
				on-chain.
			</div>
		{:else}
			<div class="squad-grid">
				{#each app.pinned as pin (pin.multisigAddress)}
					<SquadCard {pin} />
				{/each}
			</div>
		{/if}
		<AddSquadForm />
	{/if}
</div>
