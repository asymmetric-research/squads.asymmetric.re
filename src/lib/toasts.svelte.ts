import { sanitize } from './format'

export type ToastType = 'info' | 'success' | 'error'

let nextId = 0

export const toasts: { id: number; message: string; type: ToastType }[] = $state([])

export function showToast(message: string, type: ToastType = 'info') {
	const id = ++nextId
	toasts.push({ id, message: sanitize(message), type })
	setTimeout(() => {
		const i = toasts.findIndex((t) => t.id === id)
		if (i >= 0) toasts.splice(i, 1)
	}, 5000)
}
