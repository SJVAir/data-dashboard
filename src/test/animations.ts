/**
 * Waits until the animations running in `el` (and its subtree) have stopped. A cancelled animation
 * (e.g. a CSS transition replaced by another style change) rejects `finished` with an AbortError;
 * it has stopped too, so that counts as settled rather than failing the test.
 */
export async function animationsSettled(el: Element): Promise<void> {
	await Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})));
}
