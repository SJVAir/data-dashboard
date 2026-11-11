/**
 * Resolves once every finite animation running on an ancestor of `el` (e.g. its widget frame's
 * resize animation) has finished; at once when none are running (and under reduced motion, where
 * the frame doesn't animate). Endless animations are ignored, since they never finish.
 */
export async function ancestorAnimationsSettled(el: Element): Promise<void> {
	const running = document.getAnimations().filter((a) => {
		const effect = a.effect as KeyframeEffect | null;
		const target = effect?.target;
		return (
			target instanceof Element &&
			target !== el &&
			target.contains(el) &&
			Number.isFinite(effect!.getComputedTiming().endTime)
		);
	});
	await Promise.all(running.map((a) => a.finished.catch(() => {})));
}
