import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Tests are plain Node (no Svelte rendering), so `$lib` is aliased by hand
// instead of loading the SvelteKit plugin.
export default defineConfig({
	resolve: {
		alias: {
			$lib: path.resolve('src/lib'),
		},
	},
	define: {
		__RPC_URL__: JSON.stringify(''),
	},
	test: {
		environment: 'node',
		include: ['src/**/*.test.{js,ts}'],
	},
})
