<script lang="ts">
import { app, onExpandProposal } from '../app.svelte'
import { formatTimestamp, getExplorerUrl } from '../format'
import { activate } from '../keys'
import { encodeBase58, getTransactionPda } from '../squads.js'
import StatusBadge from './StatusBadge.svelte'

// biome-ignore lint/suspicious/noExplicitAny: deserialized proposal from squads.js
let { proposal }: { proposal: any } = $props()

const expanded = $derived(app.expandedProposal === proposal.index)
const toggle = () => onExpandProposal(proposal.index)

// Explorer link points at the transaction PDA, derived on click
async function openExplorer(e: MouseEvent) {
	e.stopPropagation()
	e.preventDefault()
	const [pdaBytes] = await getTransactionPda(app.multisigAddress, proposal.index)
	window.open(getExplorerUrl('account', encodeBase58(pdaBytes)), '_blank')
}
</script>

<div
	class="proposal-row"
	class:proposal-row--expanded={expanded}
	role="button"
	tabindex="0"
	aria-expanded={expanded}
	onclick={toggle}
	onkeydown={activate(toggle)}
>
	<div class="proposal-row-left">
		<span class="proposal-index">#{proposal.index}</span>
		<StatusBadge status={proposal.status} />
	</div>
	<div class="proposal-approvals">
		<span>{proposal.approved.length}/{app.multisig?.threshold || '?'} approved</span>
		{#if proposal.status.timestamp}
			<span class="text-xs text-muted">{formatTimestamp(proposal.status.timestamp)}</span>
		{/if}
		{#if proposal.status.tag === 1}
			<a
				class="explorer-link"
				href="#explorer"
				target="_blank"
				rel="noopener noreferrer"
				title="View in explorer"
				onclick={openExplorer}>↗</a
			>
		{/if}
	</div>
</div>
