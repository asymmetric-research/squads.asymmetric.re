<script lang="ts">
let { status }: { status: { name: string } } = $props()

const CLASS: Record<string, string> = {
	Draft: 'status--draft',
	Active: 'status--active',
	Approved: 'status--approved',
	Rejected: 'status--rejected',
	Executed: 'status--executed',
	Executing: 'status--active',
	Cancelled: 'status--cancelled',
}
</script>

<span class="status {CLASS[status.name] || 'status--executed'}">
	<span class="status-dot"></span>
	<span>{status.name}</span>
</span>
