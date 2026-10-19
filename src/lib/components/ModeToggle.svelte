<script lang="ts">
import { app, onSwitchMode } from '../app.svelte'
</script>

<div class="mode-toggle" role="group" aria-label="Interface mode">
	<button
		class="mode-toggle-btn"
		class:mode-toggle-btn--active={app.mode === 'lockdown'}
		title="Only your pinned, membership-verified squads"
		onclick={() => {
			if (app.mode !== 'lockdown') onSwitchMode('lockdown')
		}}>Lockdown</button
	>
	<button
		class="mode-toggle-btn mode-toggle-btn--open"
		class:mode-toggle-btn--active={app.mode === 'open'}
		title="View any multisig address (unverified)"
		onclick={() => {
			if (app.mode !== 'open') onSwitchMode('open')
		}}>Open</button
	>
</div>
