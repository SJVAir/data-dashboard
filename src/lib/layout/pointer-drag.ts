import { flushSync, tick } from "svelte";
import type { Rect } from "$lib/documents/schema";
import type { ArrangeInput, Arrangement } from "./arrangement.svelte";
import { AUTOSCROLL_EDGE, AUTOSCROLL_MAX_STEP, GRID_COLUMNS } from "./config";
import type { Size } from "./engine";
import { settle } from "./flip";
import { cellAt, cellWidth, snapDelta, type GridMetrics } from "./geometry";

export type ResizeEdge = "left" | "right" | "bottom" | "bottom-left" | "bottom-right";
export type DragKind = { mode: "move" } | { mode: "resize"; edge: ResizeEdge };

export type PointerDragOptions = {
	arrangement: Arrangement;
	/** The widget being arranged. */
	id: string;
	/** Its frame: a child of the grid element; it follows the pointer while moving. */
	frame: HTMLElement;
	kind: DragKind;
	input: Exclude<ArrangeInput, "keyboard">;
	/** How far (px) the pointer must move before the drag starts; 0 starts it at once. */
	threshold: number;
	/** Apply the arrangement and announce it (the frame's keyboard drop does the same). */
	drop: () => void;
	/** Cancel the arrangement and announce it. */
	cancel: () => void;
};

type Point = { x: number; y: number };

/**
 * The grid's metrics in page coordinates (client plus scroll), so a target cell stays right
 * while the page scrolls under the pointer.
 */
export function measureGrid(grid: HTMLElement, columns: number): GridMetrics {
	const box = grid.getBoundingClientRect();
	const style = getComputedStyle(grid);
	return {
		left: box.left + window.scrollX,
		top: box.top + window.scrollY,
		width: box.width,
		columns,
		rowHeight: parseFloat(style.gridAutoRows) || 0,
		gap: parseFloat(style.rowGap) || 0
	};
}

function toPage(p: Point): Point {
	return { x: p.x + window.scrollX, y: p.y + window.scrollY };
}

/**
 * The reading-order index (on one column) whose slot top is nearest `row`: `others` are the
 * widgets other than the dragged one, in reading order, and each takes its height in rows.
 */
export function nearestIndex(others: readonly { rect: Rect }[], row: number): number {
	let best = 0;
	let bestDistance = Math.abs(row);
	let top = 0;
	others.forEach((other, i) => {
		top += other.rect.h;
		const distance = Math.abs(row - top);
		if (distance < bestDistance) {
			best = i + 1;
			bestDistance = distance;
		}
	});
	return best;
}

/** A resize from `start` by whole cells, clamped to the minimum size and the grid. */
export function resizedRect(
	start: Rect,
	minSize: Size,
	edge: ResizeEdge,
	d: { dx: number; dy: number },
	columns: number
): Rect {
	let { x, w, h } = start;
	const horizontal = columns > 1;
	if (horizontal && edge.endsWith("right")) {
		w = Math.min(Math.max(start.w + d.dx, minSize.w), GRID_COLUMNS - start.x);
	}
	if (horizontal && edge.endsWith("left")) {
		const right = start.x + start.w;
		x = Math.min(Math.max(start.x + d.dx, 0), right - minSize.w);
		w = right - x;
	}
	if (edge.startsWith("bottom")) h = Math.max(start.h + d.dy, minSize.h);
	return { x, y: start.y, w, h };
}

/**
 * Follow one pointer from its press (`event`) on `handle` (the title bar or a resize handle):
 * once it has moved `threshold` px the widget is picked up; it then moves (following the
 * pointer with a transform) or resizes, snapping the arrangement's target only when the cell
 * changes, and autoscrolls near the viewport's top and bottom. Release drops; Escape,
 * `pointercancel`, and the window losing focus cancel. Returns a function that abandons the
 * drag (cancelling the arrangement without an announcement), e.g. when the frame goes away.
 */
export function startPointerDrag(
	event: PointerEvent,
	handle: Element,
	opts: PointerDragOptions
): () => void {
	const { arrangement, id, frame, kind, input } = opts;
	const pointerId = event.pointerId;
	let client: Point = { x: event.clientX, y: event.clientY };
	const startPage = toPage(client);
	let started = false;
	let ended = false;
	let frameRequest = 0;

	// Set when the drag starts.
	let metrics: GridMetrics;
	let grab: Point;
	let natural: Point;
	let offset: Point;
	let startRect: Rect;
	let minSize: Size;
	let lastTarget = "";

	try {
		handle.setPointerCapture(pointerId);
	} catch {
		// Not an active pointer (e.g. a synthetic event): window listeners still see it.
	}

	const mine = () => {
		const active = arrangement.active;
		return active?.id === id && active.input === input;
	};

	function begin(): boolean {
		const grid = frame.parentElement;
		if (!grid) return false;
		arrangement.pickUp(id, kind.mode, input);
		const item = arrangement.preview?.find((i) => i.id === id);
		if (!mine() || !item) return false;
		started = true;
		metrics = measureGrid(grid, arrangement.columns);
		const box = frame.getBoundingClientRect();
		natural = toPage({ x: box.left, y: box.top });
		offset = { x: frame.offsetLeft, y: frame.offsetTop };
		grab = { x: startPage.x - natural.x, y: startPage.y - natural.y };
		startRect = item.rect;
		minSize = item.minSize;
		frameRequest = requestAnimationFrame(autoscroll);
		return true;
	}

	/** Snap the target to the pointer, and (moving) put the frame under it. */
	function update(): void {
		if (!mine()) {
			end();
			return;
		}
		const p = toPage(client);
		if (kind.mode === "resize") {
			const d = snapDelta(metrics, p.x - startPage.x, p.y - startPage.y);
			const rect = resizedRect(startRect, minSize, kind.edge, d, metrics.columns);
			const key = `${rect.x},${rect.w},${rect.h}`;
			if (key === lastTarget) return;
			lastTarget = key;
			arrangement.resizeTo(rect);
			return;
		}
		const topLeft = { x: p.x - grab.x, y: p.y - grab.y };
		if (retarget(topLeft)) flushSync();
		// Where the frame sits in the grid now (offsets ignore transforms).
		const at = {
			x: natural.x + frame.offsetLeft - offset.x,
			y: natural.y + frame.offsetTop - offset.y
		};
		frame.style.transform = `translate(${topLeft.x - at.x}px, ${topLeft.y - at.y}px)`;
	}

	/** Point the arrangement at the cell (or the phone's slot) nearest `topLeft`. */
	function retarget(topLeft: Point): boolean {
		const pitchY = metrics.rowHeight + metrics.gap;
		if (metrics.columns === 1) {
			const others = arrangement.preview?.filter((i) => i.id !== id) ?? [];
			const index = nearestIndex(others, (topLeft.y - metrics.top) / pitchY);
			const key = `#${index}`;
			if (key === lastTarget) return false;
			lastTarget = key;
			arrangement.moveToIndex(index);
			return true;
		}
		// The cell nearest the frame's top-left corner.
		const pitchX = cellWidth(metrics) + metrics.gap;
		const cell = cellAt(metrics, { x: topLeft.x + pitchX / 2, y: topLeft.y + pitchY / 2 });
		const x = Math.min(cell.x, GRID_COLUMNS - startRect.w);
		const key = `${x},${cell.y}`;
		if (key === lastTarget) return false;
		lastTarget = key;
		arrangement.moveTo({ x, y: cell.y });
		return true;
	}

	function autoscroll(): void {
		const y = client.y;
		const bottom = window.innerHeight - AUTOSCROLL_EDGE;
		let step = 0;
		if (y < AUTOSCROLL_EDGE) step = -speed(AUTOSCROLL_EDGE - y);
		else if (y > bottom) step = speed(y - bottom);
		// The scroll event that follows updates the target.
		if (step !== 0) window.scrollBy({ top: step, behavior: "instant" });
		frameRequest = requestAnimationFrame(autoscroll);
	}

	function finish(how: "drop" | "cancel"): void {
		const from = kind.mode === "move" ? frame.getBoundingClientRect() : null;
		end();
		if (!mine()) return;
		if (how === "drop") opts.drop();
		else opts.cancel();
		// Slide from where it was let go to where it lands (instant under reduced motion).
		if (from) void tick().then(() => settle(frame, from));
	}

	function onMove(e: PointerEvent): void {
		if (e.pointerId !== pointerId) return;
		client = { x: e.clientX, y: e.clientY };
		if (!started) {
			const moved = Math.hypot(e.clientX - event.clientX, e.clientY - event.clientY);
			if (moved < opts.threshold) return;
			if (!begin()) {
				end();
				return;
			}
		}
		update();
	}

	function onUp(e: PointerEvent): void {
		if (e.pointerId !== pointerId) return;
		if (started) finish("drop");
		else end();
	}

	function onCancel(e: Event): void {
		if (e instanceof PointerEvent && e.pointerId !== pointerId) return;
		if (started) finish("cancel");
		else end();
	}

	function onKey(e: KeyboardEvent): void {
		if (!started || e.key !== "Escape") return;
		// Before the title bar's own keyboard handling sees it.
		e.preventDefault();
		e.stopPropagation();
		finish("cancel");
	}

	function onScroll(): void {
		if (started) update();
	}

	function end(): void {
		if (ended) return;
		ended = true;
		window.removeEventListener("pointermove", onMove, true);
		window.removeEventListener("pointerup", onUp, true);
		window.removeEventListener("pointercancel", onCancel, true);
		window.removeEventListener("keydown", onKey, true);
		window.removeEventListener("blur", onCancel);
		window.removeEventListener("scroll", onScroll);
		cancelAnimationFrame(frameRequest);
		frame.style.transform = "";
		try {
			if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
		} catch {
			// Already released.
		}
	}

	window.addEventListener("pointermove", onMove, true);
	window.addEventListener("pointerup", onUp, true);
	window.addEventListener("pointercancel", onCancel, true);
	window.addEventListener("keydown", onKey, true);
	window.addEventListener("blur", onCancel);
	window.addEventListener("scroll", onScroll, { passive: true });

	return () => {
		const active = started && !ended && mine();
		end();
		if (active) arrangement.cancel();
	};
}

/** Autoscroll speed (px per frame) for a pointer `depth` px into the edge zone (or past it). */
function speed(depth: number): number {
	return Math.ceil(Math.min(depth / AUTOSCROLL_EDGE, 1) * AUTOSCROLL_MAX_STEP);
}
