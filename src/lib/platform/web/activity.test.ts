import { describe, expect, it } from "vitest";
import { createWebActivity } from "./activity";

function fakePage(state: DocumentVisibilityState) {
	return Object.assign(new EventTarget(), { visibilityState: state });
}

describe("createWebActivity", () => {
	it("reports page visibility and its changes until stopped", () => {
		const page = fakePage("visible");
		const activity = createWebActivity(page as unknown as Document);
		const heard: boolean[] = [];
		const stop = activity.onChange((v) => heard.push(v));
		expect(activity.visible()).toBe(true);

		page.visibilityState = "hidden";
		page.dispatchEvent(new Event("visibilitychange"));
		expect(activity.visible()).toBe(false);
		stop();
		page.visibilityState = "visible";
		page.dispatchEvent(new Event("visibilitychange"));
		expect(heard).toEqual([false]);
	});
});
