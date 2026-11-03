/** Why the account refused a dashboard, for the Saved popover, the list, and the notice bar. */
import { formatNumber } from "$lib/format";
import { m } from "$lib/paraglide/messages.js";
import type { SyncHold } from "$lib/sync/types";

export type RefusalCode = Extract<SyncHold, { kind: "refused" }>["code"];

/** The notice bar's order. */
export const REFUSAL_CODES: RefusalCode[] = [
	"too_large",
	"limit_documents",
	"limit_storage",
	"invalid"
];

const ONE: Record<RefusalCode, () => string> = {
	too_large: m.sync_refused_too_large,
	limit_documents: m.sync_refused_limit_documents,
	limit_storage: m.sync_refused_limit_storage,
	invalid: m.sync_refused_invalid
};

const MANY: Record<RefusalCode, (inputs: { count: string; countValue: number }) => string> = {
	too_large: m.sync_held_too_large,
	limit_documents: m.sync_held_limit_documents,
	limit_storage: m.sync_held_limit_storage,
	invalid: m.sync_held_invalid
};

/** Why this dashboard is only on this device. */
export function refusedMessage(code: RefusalCode): string {
	return ONE[code]();
}

/** How many dashboards the account refused for `code`. */
export function heldMessage(code: RefusalCode, count: number): string {
	return MANY[code]({ count: formatNumber(count), countValue: count });
}
