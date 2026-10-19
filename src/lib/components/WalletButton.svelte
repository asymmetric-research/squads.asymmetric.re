<script lang="ts">
import { app, onDisconnect } from '../app.svelte'
import { shortenAddress } from '../squads.js'
</script>

{#if app.walletAccount}
	<button class="btn btn-sm btn-wallet" onclick={onDisconnect}>
		{#if app.connectedWallet?.icon}
			<img src={app.connectedWallet.icon} width="16" height="16" class="wallet-icon" alt="" />
		{/if}
		<span>{shortenAddress(app.walletAccount.address)}</span>
	</button>
{:else}
	<button class="btn btn-primary btn-sm" onclick={() => (app.showWalletPicker = true)}>Connect</button>
{/if}
