import type { Dashboard } from "$lib/documents/schema";
import type { Change } from "./types";
import { applyChange, appliedChange, ChangeTargetMissing } from "./apply";
import { replaceIfOverlapping } from "./rebase";

type Entry = { change: Change; inverse: Change };

/** What an undo or redo did: the new document, the change it applied, and that change's inverse. */
export type UndoResult = { doc: Dashboard; change: Change; inverse: Change };

/**
 * Per-document, per-tab undo/redo history (not persisted). Entries hold the forward change
 * and its inverse. An entry whose target no longer exists (another tab removed the widget)
 * is discarded and the next one runs; a widget re-added where another now sits is re-placed
 * at the bottom.
 */
export class UndoStack {
	#undo: Entry[] = [];
	#redo: Entry[] = [];

	get canUndo(): boolean {
		return this.#undo.length > 0;
	}

	get canRedo(): boolean {
		return this.#redo.length > 0;
	}

	push(change: Change, inverse: Change): void {
		this.#undo.push({ change, inverse });
		this.#redo = [];
	}

	takeUndo(doc: Dashboard): UndoResult | null {
		const result = takeFrom(this.#undo, doc, (entry) => entry.inverse);
		if (result) this.#redo.push({ change: result.inverse, inverse: result.change });
		return result;
	}

	takeRedo(doc: Dashboard): UndoResult | null {
		const result = takeFrom(this.#redo, doc, (entry) => entry.change);
		if (result) this.#undo.push({ change: result.change, inverse: result.inverse });
		return result;
	}

	clear(): void {
		this.#undo = [];
		this.#redo = [];
	}
}

function takeFrom(
	stack: Entry[],
	doc: Dashboard,
	pick: (entry: Entry) => Change
): UndoResult | null {
	for (let entry = stack.pop(); entry; entry = stack.pop()) {
		try {
			const result = applyChange(doc, replaceIfOverlapping(doc, pick(entry)));
			return { doc: result.doc, change: appliedChange(result.inverse), inverse: result.inverse };
		} catch (error) {
			if (!(error instanceof ChangeTargetMissing)) throw error;
		}
	}
	return null;
}
