import { describe, expect, it, vi } from "vitest";
import type { Dashboard } from "$lib/documents/schema";
import { finishMoves } from "./move";
import { uploadDocument } from "./upload";
import { SPACE, edit, setupSync, storeDoc, stored, title, titles } from "./test-support";

vi.mock("$lib/safety/report", () => ({ report: vi.fn() }));

describe("moves", () => {
	it("id_taken moves to a new id and late edits follow", async () => {
		const { platform, fake, ctx, posted } = await setupSync();
		await storeDoc(platform);
		await edit(platform, [title("a", "Mine")]);
		fake.ownerOf("d1", "someone-else");

		expect(await uploadDocument(ctx, "d1")).toBe("held");
		const record = await platform.sync.get(SPACE, "d1");
		expect(record?.hold).toMatchObject({ kind: "moved", through: 1 });
		const to = record?.hold?.kind === "moved" ? record.hold.to : "";
		expect(to).not.toBe("d1");
		const copy = await stored(platform, to);
		expect(copy).toMatchObject({ id: to, copiedFrom: "d1" });
		expect(titles(copy)).toEqual(["Mine", null]);
		expect(posted).toContainEqual({
			type: "moved",
			space: SPACE,
			from: "d1",
			to,
			tabId: ctx.tabId
		});

		// A tab that hadn't moved yet keeps editing the old id.
		await edit(platform, [title("b", "Late")]);
		await finishMoves(ctx);
		expect(await platform.documents.get(SPACE, "d1")).toBeUndefined();
		expect(await platform.sync.get(SPACE, "d1")).toBeUndefined();
		expect(titles(await stored(platform, to))).toEqual(["Mine", "Late"]);

		// The copy uploads under its new id; the other account's document is untouched.
		expect(await uploadDocument(ctx, to)).toBe("saved");
		const server = await fake.get(to);
		expect(server.copiedFrom).toBe("d1");
		expect(titles({ ...copy, body: server.body as Dashboard["body"] })).toEqual(["Mine", "Late"]);
		expect(fake.requests.filter((r) => r === "save d1")).toHaveLength(1);
	});
});
