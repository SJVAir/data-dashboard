import type { Platform, Protection, SpaceId } from "$lib/platform/types";
import { REMINDER_KEY, updateReminderPrefs, type ReminderPrefs } from "./reminder";

/**
 * Whether the browser promises to keep this space's data, and the request to make it so.
 * Where requesting shows a browser prompt (Firefox) it only happens on a click.
 */
export class StorageProtection {
	state = $state<Protection>("unknown");
	/** Set once `refresh()` has read the state and the stored refusal. */
	ready = $state(false);
	refused = $state(false);
	readonly prompts: boolean;
	/** Where "Protect my dashboards" is offered in the status note: refusal doesn't hide it. */
	get canOffer(): boolean {
		return this.prompts && this.state !== "protected";
	}
	/** Where it's offered in the reminder bar: a refusal takes it away. */
	get canOfferInBar(): boolean {
		return this.canOffer && !this.refused;
	}

	readonly #platform: Platform;
	readonly #space: SpaceId;

	constructor(platform: Platform, space: SpaceId) {
		this.#platform = platform;
		this.#space = space;
		this.prompts = platform.persistence.prompts();
	}

	async refresh(): Promise<void> {
		try {
			this.state = await this.#platform.persistence.persisted();
		} catch {
			this.state = "unknown";
		}
		try {
			const prefs = await this.#platform.preferences.get<ReminderPrefs>(this.#space, REMINDER_KEY);
			this.refused = prefs?.persistRefused === true;
		} catch {
			// Preferences are a convenience; stay as if never refused.
		}
		this.ready = true;
	}

	/** Asks without a prompt on first create/edit, where the browser decides silently. */
	async requestAuto(): Promise<void> {
		if (this.prompts) return;
		await this.#request();
	}

	/** Asks because the person clicked "Protect my dashboards". */
	async requestByClick(): Promise<void> {
		await this.#request();
		if (this.state === "protected") return;
		this.refused = true;
		try {
			await updateReminderPrefs(this.#platform, this.#space, { persistRefused: true });
		} catch {
			// Kept for this page load.
		}
	}

	async #request(): Promise<void> {
		try {
			this.state = await this.#platform.persistence.request();
		} catch {
			this.state = "unknown";
		}
	}
}
