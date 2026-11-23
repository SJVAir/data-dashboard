import { describe, expect, it } from "vitest";
import { mapSend, setMapSend, type MapSendEntry } from "./send-registry";

const entry = (marks: string[]): MapSendEntry => ({
	marks,
	leftOut: 0,
	draft: () => ({ type: "map", data: {} as never })
});

describe("send registry", () => {
	it("sets and gets an entry", () => {
		const a = Symbol();
		const e = entry(["a"]);
		const remove = setMapSend("w1", a, e);
		expect(mapSend("w1")).toBe(e);
		remove();
		expect(mapSend("w1")).toBeNull();
	});

	it("returns null for an unknown widget", () => {
		expect(mapSend("nope")).toBeNull();
	});

	it("the latest owner wins; removing one leaves the other", () => {
		const a = Symbol();
		const b = Symbol();
		const ea = entry(["a"]);
		const eb = entry(["b"]);
		const removeA = setMapSend("w2", a, ea);
		const removeB = setMapSend("w2", b, eb);
		expect(mapSend("w2")).toBe(eb);
		removeB();
		expect(mapSend("w2")).toBe(ea);
		removeA();
		expect(mapSend("w2")).toBeNull();
	});

	it("an update by an earlier owner becomes the latest", () => {
		const a = Symbol();
		const b = Symbol();
		setMapSend("w3", a, entry(["a"]));
		setMapSend("w3", b, entry(["b"]));
		const e2 = entry(["a2"]);
		setMapSend("w3", a, e2);
		expect(mapSend("w3")).toBe(e2);
		setMapSend("w3", a, null);
		setMapSend("w3", b, null);
	});

	it("null clears", () => {
		const a = Symbol();
		setMapSend("w4", a, entry(["a"]));
		setMapSend("w4", a, null);
		expect(mapSend("w4")).toBeNull();
	});
});
