import type { JournalStorage, SpaceId } from "../types";

const PREFIX = "sjvair-workspace:journal:";

const docPrefix = (space: SpaceId, docId: string) => `${PREFIX}${space}:${docId}:`;

/**
 * The journal in `localStorage`, which (unlike IndexedDB) is written synchronously, so a record
 * written in `pagehide` survives the page being torn down. Keys:
 * `sjvair-workspace:journal:<space>:<docId>:<tabId>`. Storage that is blocked or full makes
 * every call a no-op.
 */
export function createWebJournal(storage: () => Storage = () => localStorage): JournalStorage {
	return {
		write(space, docId, tabId, record) {
			try {
				storage().setItem(docPrefix(space, docId) + tabId, JSON.stringify(record));
			} catch {
				// Quota or blocked storage: nothing more can be done as the page goes away.
			}
		},
		readAll(space, docId) {
			const prefix = docPrefix(space, docId);
			const found: Array<{ tabId: string; record: unknown }> = [];
			try {
				const s = storage();
				for (let i = 0; i < s.length; i++) {
					const key = s.key(i);
					if (key === null || !key.startsWith(prefix)) continue;
					let record: unknown;
					try {
						record = JSON.parse(s.getItem(key) ?? "null");
					} catch {
						record = null;
					}
					found.push({ tabId: key.slice(prefix.length), record });
				}
			} catch {
				return [];
			}
			return found;
		},
		clear(space, docId, tabId) {
			try {
				storage().removeItem(docPrefix(space, docId) + tabId);
			} catch {
				// Blocked storage: there is nothing to clear.
			}
		}
	};
}
