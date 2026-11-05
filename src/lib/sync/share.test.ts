import { describe, expect, it, vi } from "vitest";
import { RemoteRefusal } from "./remote";
import { shareDocument, unshareDocument } from "./share";
import { uploadDocument } from "./upload";
import { SPACE, edit, setupSync, storeDoc, title } from "./test-support";

vi.mock("$lib/safety/report", () => ({ report: vi.fn() }));

/** A created dashboard, synced at server version 1. */
async function synced() {
	const setup = await setupSync();
	await storeDoc(setup.platform);
	expect(await uploadDocument(setup.ctx, "d1")).toBe("saved");
	setup.fake.requests.length = 0;
	return setup;
}

describe("shareDocument", () => {
	it("share uploads first, then shares the synced version", async () => {
		const { platform, fake, ctx, posted } = await synced();
		await edit(platform, [title("a", "Mine")]);

		const result = await shareDocument(ctx, "d1");
		expect(fake.requests).toEqual(["save d1", "share d1"]);
		const token = (await fake.get("d1")).shareToken;
		expect(token).toEqual(expect.any(String));
		expect(result).toEqual({ kind: "shared", token, unsynced: false });
		expect((await fake.get("d1")).version).toBe(2);
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({ shareToken: token });
		expect(posted).toContainEqual({ type: "sync", space: SPACE, docId: "d1", tabId: ctx.tabId });
	});

	it("with an edit that can't upload, it shares the last synced version", async () => {
		const { platform, fake, ctx } = await synced();
		await edit(platform, [title("a", "Mine")]);
		fake.refuseNext.push({ code: "rate_limited", status: 429 });

		const result = await shareDocument(ctx, "d1");
		expect(fake.requests).toEqual(["save d1", "share d1"]);
		const server = await fake.get("d1");
		expect(server.version).toBe(1);
		expect(result).toEqual({ kind: "shared", token: server.shareToken, unsynced: true });
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({
			serverVersion: 1,
			shareToken: server.shareToken
		});
	});

	it("with a check, shares only when the uploaded version passes it", async () => {
		const { platform, fake, ctx } = await synced();
		await edit(platform, [title("a", "Mine")]);
		const seen: (string | null)[] = [];
		const result = await shareDocument(ctx, "d1", {
			onlyIf: (doc) => {
				seen.push(doc.body.widgets[0].title);
				return true;
			}
		});
		expect(result).toMatchObject({ kind: "shared", unsynced: false });
		// Checked on what was uploaded: the edit is in it.
		expect(seen).toEqual(["Mine"]);
		expect(fake.requests).toEqual(["save d1", "share d1"]);
	});

	it("a failed check refuses without sharing", async () => {
		const { fake, ctx } = await synced();
		const result = await shareDocument(ctx, "d1", { onlyIf: () => false });
		expect(result).toEqual({ kind: "check-failed" });
		expect(fake.requests).not.toContain("share d1");
		expect((await fake.get("d1")).shareToken).toBeNull();
	});

	it("with a check, an edit that can't upload refuses (the server's version is unchecked)", async () => {
		const { platform, fake, ctx } = await synced();
		await edit(platform, [title("a", "Mine")]);
		fake.refuseNext.push({ code: "rate_limited", status: 429 });
		const result = await shareDocument(ctx, "d1", { onlyIf: () => true });
		expect(result).toEqual({ kind: "check-failed" });
		expect(fake.requests).not.toContain("share d1");
	});

	it("a dashboard never uploaded can't share", async () => {
		const { platform, fake, ctx } = await setupSync();
		fake.maxDocuments = 0;
		await storeDoc(platform);

		const result = await shareDocument(ctx, "d1");
		expect(result).toEqual({
			kind: "not-on-server",
			hold: { kind: "refused", code: "limit_documents" }
		});
		expect(fake.requests).not.toContain("share d1");
	});

	it("a blocked account gets blocked", async () => {
		const { platform, fake, ctx } = await synced();
		fake.blockSharing("u1");

		expect(await shareDocument(ctx, "d1")).toEqual({ kind: "blocked" });
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({ shareToken: null });
	});

	it("offline gets offline", async () => {
		const { platform, fake, ctx } = await synced();
		fake.offline = true;

		expect(await shareDocument(ctx, "d1")).toEqual({ kind: "offline" });
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({ shareToken: null });
	});

	it("a dashboard the server doesn't have is not on the server", async () => {
		const { fake, ctx } = await synced();
		fake.refuseNext.push({ code: "not_found", status: 404 });

		expect(await shareDocument(ctx, "d1")).toEqual({ kind: "not-on-server", hold: null });
	});

	it("stop sharing clears the token", async () => {
		const { platform, fake, ctx, posted } = await synced();
		const shared = await shareDocument(ctx, "d1");
		expect(shared.kind).toBe("shared");
		posted.length = 0;

		await unshareDocument(ctx, "d1");
		expect((await fake.get("d1")).shareToken).toBeNull();
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({ shareToken: null });
		expect(posted).toContainEqual({ type: "sync", space: SPACE, docId: "d1", tabId: ctx.tabId });

		// Sharing again makes a new link.
		const again = await shareDocument(ctx, "d1");
		expect(again.kind === "shared" && shared.kind === "shared" && again.token).not.toBe(
			shared.kind === "shared" && shared.token
		);
	});

	it("stop sharing throws on a refusal and keeps the token", async () => {
		const { platform, fake, ctx } = await synced();
		const shared = await shareDocument(ctx, "d1");
		fake.refuseNext.push({ code: "unknown", status: 500 });

		await expect(unshareDocument(ctx, "d1")).rejects.toBeInstanceOf(RemoteRefusal);
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({
			shareToken: shared.kind === "shared" ? shared.token : "?"
		});
	});
});
