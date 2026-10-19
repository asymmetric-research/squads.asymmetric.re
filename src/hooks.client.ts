// Halt the page if anything adds a <script> at runtime. Vite loads chunks with
// import() and modulepreload links, never script elements, so a new one is
// always injected.
new MutationObserver((mutations) => {
	for (const m of mutations) {
		for (const node of m.addedNodes) {
			if (node instanceof HTMLScriptElement) {
				document.body.textContent =
					'Security violation: unexpected script detected. Reload from a trusted source.'
				throw new Error('Script injection detected')
			}
		}
	}
}).observe(document.documentElement, { childList: true, subtree: true })
