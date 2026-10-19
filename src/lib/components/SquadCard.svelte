<script lang="ts">
import { loadPins, onOpenSquad, onUnpin, type Pinned } from '../app.svelte'
import { sanitize } from '../format'
import { activate } from '../keys'
import { shortenAddress } from '../squads.js'
import Address from './Address.svelte'

let { pin }: { pin: Pinned } = $props()

const isMember = $derived(!!pin.membership)
const clickable = $derived(!pin.error && isMember)

const open = () => onOpenSquad(pin.multisigAddress)
</script>

{#snippet content()}
	<div class="squad-card-top">
		<span class="squad-card-label">{sanitize(pin.label) || shortenAddress(pin.multisigAddress)}</span>
		<button
			class="btn btn-ghost btn-sm squad-unpin"
			title="Unpin this squad"
			onclick={(e) => {
				e.stopPropagation()
				onUnpin(pin.multisigAddress)
			}}>Unpin</button
		>
	</div>
	<div class="squad-card-addr"><Address pubkey={pin.multisigAddress} /></div>

	{#if pin.error}
		<!-- Failed cards are never silently dropped -->
		<div class="squad-card-status squad-card-status--error">{sanitize(pin.error)}</div>
		<button
			class="btn btn-sm mt-sm"
			onclick={(e) => {
				e.stopPropagation()
				loadPins()
			}}>Retry</button
		>
	{:else}
		<div class="squad-card-stats">
			<span>Threshold {pin.multisig.threshold}/{pin.multisig.members.length}</span>
			<span>{pin.multisig.transactionIndex} txns</span>
		</div>
		{#if isMember}
			<div class="squad-card-status squad-card-status--member">
				Member · {pin.membership.permissions.join(', ') || 'no permissions'}
			</div>
		{:else}
			<!-- Roster changed since pinning: keep visible + badged, actions locked -->
			<div class="squad-card-status squad-card-status--revoked">No longer a member</div>
		{/if}
	{/if}
{/snippet}

{#if clickable}
	<div
		class="squad-card squad-card--clickable"
		role="button"
		tabindex="0"
		onclick={open}
		onkeydown={activate(open)}
	>
		{@render content()}
	</div>
{:else}
	<div class="squad-card" class:squad-card--error={pin.error} class:squad-card--revoked={!pin.error && !isMember}>
		{@render content()}
	</div>
{/if}
