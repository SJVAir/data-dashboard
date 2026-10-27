import { displayName } from "$lib/account/names";
import { sameAccount, sameIdentity, type Identity } from "$lib/account/identity";
import { m } from "$lib/paraglide/messages.js";
import type { IdentityCause, IdentitySource } from "$lib/platform/types";
import type { TabChannel } from "./tab-channel";

/** Shows a short message to the person (a toast in the app). */
export type Notify = { info(message: string): void; error(message: string): void };

/**
 * What to tell the person when the identity changes from `prev` to `next` without this tab
 * causing it, or `null` to say nothing (the first answer on load, or the same account).
 */
export function changeMessage(prev: Identity, next: Identity): string | null {
	if (prev.state === "unknown" || sameAccount(prev, next)) return null;
	if (next.state === "signed-out") return m.account_signed_out_elsewhere();
	if (next.state !== "signed-in") return null;
	const name = displayName(next.user.full_name);
	if (prev.state === "signed-out") {
		return name ? m.account_signed_in_as_toast({ name }) : m.account_signed_in_unnamed_toast();
	}
	return name ? m.account_switched_to({ name }) : m.account_switched_unnamed();
}

/**
 * Who is signed in, for the UI. Follows the platform's identity, shares the changes this tab
 * learns of with the other tabs, and tells the person about changes this tab didn't cause.
 */
export class AccountState {
	// Replaced whole, never mutated, so no deep proxy (it's also posted to other tabs).
	#identity = $state.raw<Identity>({ state: "unknown" });
	readonly #stops: Array<() => void>;

	constructor(
		private readonly source: IdentitySource,
		private readonly channel: TabChannel,
		private readonly tabId: string,
		private readonly notify: Notify
	) {
		this.#identity = source.current();
		this.#stops = [
			source.onChange((next, cause) => this.#changed(next, cause)),
			channel.subscribe((msg) => {
				if (msg.type === "identity" && msg.tabId !== tabId) source.accept(msg.identity);
			})
		];
	}

	get identity(): Identity {
		return this.#identity;
	}

	/** Ask the server now (the account menu opening). */
	recheck(): void {
		void this.source.recheck({ force: true });
	}

	async signOut(): Promise<void> {
		if (!(await this.source.signOut())) this.notify.error(m.account_sign_out_failed());
	}

	dispose(): void {
		for (const stop of this.#stops) stop();
	}

	#changed(next: Identity, cause: IdentityCause): void {
		const prev = this.#identity;
		this.#identity = next;
		switch (cause) {
			case "load":
				return;
			case "recheck":
				this.#tell(changeMessage(prev, next));
				if (!sameIdentity(prev, next)) this.#broadcast(next);
				return;
			case "tab":
				this.#tell(changeMessage(prev, next));
				return;
			case "sign-out":
				this.notify.info(m.account_signed_out());
				this.#broadcast(next);
				return;
		}
	}

	#tell(message: string | null): void {
		if (message) this.notify.info(message);
	}

	#broadcast(identity: Identity): void {
		// Never "unknown": other tabs would reject it.
		if (identity.state === "unknown") return;
		this.channel.post({ type: "identity", identity, tabId: this.tabId });
	}
}
