<script lang="ts">
import { toasts } from '../toasts.svelte'
</script>

<div class="toast-container">
	{#each toasts as toast (toast.id)}
		<div class="toast toast-{toast.type}">{toast.message}</div>
	{/each}
</div>
