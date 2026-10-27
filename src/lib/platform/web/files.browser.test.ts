import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebFiles } from "./files";

afterEach(() => vi.restoreAllMocks());

describe("createWebFiles", () => {
	it("save clicks an anchor with the download name", () => {
		const seen: Array<{ download: string; href: string }> = [];
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
			this: HTMLAnchorElement
		) {
			seen.push({ download: this.download, href: this.href });
		});
		createWebFiles().save("backup.json", "{}", "application/json");
		expect(seen).toHaveLength(1);
		expect(seen[0].download).toBe("backup.json");
		expect(seen[0].href).toMatch(/^blob:/);
	});

	it("open resolves null when the picker is cancelled", async () => {
		const inputs: HTMLInputElement[] = [];
		vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
			this: HTMLInputElement
		) {
			inputs.push(this);
			queueMicrotask(() => this.dispatchEvent(new Event("cancel")));
		});
		expect(await createWebFiles().open(".json")).toBeNull();
		expect(inputs[0].type).toBe("file");
		expect(inputs[0].accept).toBe(".json");
	});

	it("open resolves the chosen file", async () => {
		vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
			this: HTMLInputElement
		) {
			const dt = new DataTransfer();
			dt.items.add(new File(["hello"], "a.json"));
			this.files = dt.files;
			queueMicrotask(() => this.dispatchEvent(new Event("change")));
		});
		const file = await createWebFiles().open(".json");
		expect(file?.name).toBe("a.json");
		expect(file?.size).toBe(5);
		expect(await file?.text()).toBe("hello");
	});
});
