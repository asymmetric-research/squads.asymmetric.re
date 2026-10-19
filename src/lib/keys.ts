/** Keyboard activation for role="button" elements: Enter or Space on the element itself. */
export function activate(fn: () => void) {
	return (e: KeyboardEvent) => {
		if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
		e.preventDefault()
		fn()
	}
}
