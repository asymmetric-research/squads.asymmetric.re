<script lang="ts">
import { onAddPin } from '../app.svelte'
import { isValidBase58 } from '../squads.js'

let address = $state('')
let label = $state('')
let error = $state('')
let adding = $state(false)

async function add() {
	if (adding) return
	const addr = address.trim()
	if (!isValidBase58(addr)) {
		error = 'Not a valid base58 address'
		return
	}
	error = ''
	adding = true
	try {
		if (await onAddPin(addr, label.trim())) {
			address = ''
			label = ''
		}
	} catch (err) {
		error = `Verification failed: ${(err as Error).message}`
	} finally {
		adding = false
	}
}
</script>

<div class="add-squad">
	<div class="section-header">Add a squad</div>
	<div class="add-squad-row">
		<input
			class="add-squad-input"
			type="text"
			placeholder="Multisig, vault, or proposal address..."
			bind:value={address}
			onkeydown={(e) => e.key === 'Enter' && add()}
		/>
		<input class="add-squad-label" type="text" maxlength="32" placeholder="Nickname (optional)" bind:value={label} />
		<button class="btn btn-primary" disabled={adding} onclick={add}
			>{adding ? 'Verifying on-chain...' : 'Verify & pin'}</button
		>
	</div>
	<p class="error-inline" class:visible={error}>{error}</p>
	<p class="text-xs text-muted mt-sm">
		Pinning is refused unless your connected wallet is a member of the multisig on-chain.
	</p>
</div>
