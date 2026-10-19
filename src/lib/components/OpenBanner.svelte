<script lang="ts">
import { app, onStickyOpenChange } from '../app.svelte'
</script>

<div class="open-banner">
	<span class="open-banner-text">Open mode — addresses here are not membership-verified.</span>
	<label class="open-banner-sticky">
		<input
			type="checkbox"
			checked={app.stickyOpen}
			onchange={(e) => onStickyOpenChange(e.currentTarget.checked)}
		/>
		<span>Stay in open mode</span>
	</label>
</div>
