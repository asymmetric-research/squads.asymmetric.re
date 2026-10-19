<script lang="ts">
import { MediaQuery } from 'svelte/reactivity'
import { asset } from '$app/paths'

let { kind, height }: { kind: 'logo' | 'logotype'; height: number } = $props()

const dark = new MediaQuery('(prefers-color-scheme: dark)')
</script>

<img src={asset(`/${kind}-${dark.current ? 'white' : 'black'}.svg`)} {height} alt="Squads" />
