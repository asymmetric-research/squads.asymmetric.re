<script lang="ts">
import { getExplorerUrl, sanitize } from '../format'
import { shortenAddress } from '../squads.js'

let {
	pubkey,
	short = true,
	explorer = true,
}: { pubkey: string; short?: boolean; explorer?: boolean } = $props()

const clean = $derived(sanitize(pubkey))
const display = $derived(short ? shortenAddress(clean) : clean)
let copied = $state(false)

function copy(e: MouseEvent) {
	e.stopPropagation()
	navigator.clipboard.writeText(clean).then(() => {
		copied = true
		setTimeout(() => {
			copied = false
		}, 1500)
	})
}
</script>

<span class="flex gap-sm">
	{#if explorer}
		<a class="addr" href={getExplorerUrl('account', clean)} target="_blank" rel="noopener noreferrer" title={clean}
			>{display}</a
		>
	{:else}
		<span class="addr" title={clean}>{display}</span>
	{/if}
	<button class="copy-btn" title="Copy address" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
</span>
