import { JOURNAL_RECORD_MAX, type JournalStorage, type SpaceId } from "../types";

const PREFIX = "sjvair-workspace:journal:";

const docPrefix = (space: SpaceId, docId: string) => `${PREFIX}${space}:${docId}:`;

/**
 * The journal in `localStorage`, which (unlike IndexedDB) is written synchronously, so a record
 * written in `pagehide` survives the page being torn down. Keys:
 * `sjvair-workspace:journal:<space>:<docId>:<tabId>`. Storage that is blocked or full makes
 * every call a no-op. Dashboard ids contain no colon (the tab id may). A record whose JSON is
 * over `JOURNAL_RECORD_MAX` characters isn't written.
 */
export function createWebJournal(storage: () => Storage = () => localStorage): JournalStorage {
	return {
		write(space, docId, tabId, record) {
			try {
				const json = JSON.stringify(record);
				if (json.length > JOURNAL_RECORD_MAX) return;
				storage().setItem(docPrefix(space, docId) + tabId, json);
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
		list(space) {
			const prefix = `${PREFIX}${space}:`;
			const found: Array<{ docId: string; tabId: string; record: unknown }> = [];
			try {
				const s = storage();
				for (let i = 0; i < s.length; i++) {
					const key = s.key(i);
					if (key === null || !key.startsWith(prefix)) continue;
					const rest = key.slice(prefix.length);
					const colon = rest.indexOf(":");
					if (colon < 0) continue;
					let record: unknown;
					try {
						record = JSON.parse(s.getItem(key) ?? "null");
					} catch {
						record = null;
					}
					found.push({ docId: rest.slice(0, colon), tabId: rest.slice(colon + 1), record });
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
