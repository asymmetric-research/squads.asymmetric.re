<script lang="ts">
import { app, onConnect } from '../app.svelte'

const close = () => (app.showWalletPicker = false)
// biome-ignore lint/suspicious/noExplicitAny: Wallet Standard wallets are untyped here
const wallets: any[] = app.wallet.getAvailableWallets()
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && close()} />

<!-- The overlay is a click-outside target; Escape (above) is the keyboard equivalent. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="modal-overlay" onclick={close}>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="modal" onclick={(e) => e.stopPropagation()}>
		<h3>Connect wallet</h3>
		{#if wallets.length === 0}
			<p class="text-muted">No Solana wallet detected. Install Phantom, Solflare, or Backpack.</p>
		{:else}
			<div class="wallet-list">
				{#each wallets as wallet (wallet.name)}
					<button class="wallet-option" onclick={() => onConnect(wallet)}>
						{#if wallet.icon}
							<img src={wallet.icon} width="28" height="28" alt="" />
						{/if}
						<span>{wallet.name}</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>
