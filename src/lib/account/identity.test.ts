import { describe, expect, it } from "vitest";
import { parseIdentityBlock, sameAccount, sameIdentity, type Identity } from "./identity";

const user = {
	id: "abc123",
	full_name: "Maria Lopez",
	email: "m@example.org",
	phone: "+15595550111",
	phone_verified: true,
	language: "en"
};

describe("parseIdentityBlock", () => {
	it("reads a null user as signed out", () => {
		expect(parseIdentityBlock('{"v":1,"user":null}')).toEqual({
			identity: { state: "signed-out" },
			unreadable: false
		});
	});

	it("reads a valid user as signed in and drops unknown keys", () => {
		const result = parseIdentityBlock(JSON.stringify({ v: 1, user: { ...user, is_admin: true } }));
		expect(result).toEqual({ identity: { state: "signed-in", user }, unreadable: false });
	});

	it("keeps a script-closing name intact", () => {
		const text = JSON.stringify({ v: 1, user: { ...user, full_name: "</script>" } });
		const result = parseIdentityBlock(text);
		expect(result.identity).toMatchObject({ user: { full_name: "</script>" } });
	});

	it("reads Django-escaped characters", () => {
		const text =
			'{"v":1,"user":' + JSON.stringify(user).replace("Maria", "\\u003CMaria\\u003E") + "}";
		expect(parseIdentityBlock(text).identity).toMatchObject({
			user: { full_name: "<Maria> Lopez" }
		});
	});

	it("flags an unknown version as unreadable", () => {
		expect(parseIdentityBlock('{"v":2,"user":null}')).toEqual({
			identity: { state: "signed-out" },
			unreadable: true
		});
	});

	it("flags non-JSON as unreadable", () => {
		expect(parseIdentityBlock("nope")).toEqual({
			identity: { state: "signed-out" },
			unreadable: true
		});
	});

	it("flags a user missing id as unreadable", () => {
		const rest: Partial<typeof user> = { ...user };
		delete rest.id;
		const result = parseIdentityBlock(JSON.stringify({ v: 1, user: rest }));
		expect(result).toEqual({ identity: { state: "signed-out" }, unreadable: true });
	});
});

describe("sameAccount and sameIdentity", () => {
	const a: Identity = { state: "signed-in", user };
	const b: Identity = { state: "signed-in", user: { ...user, full_name: "María L." } };

	it("treats the same id with a different name as the same account but not the same identity", () => {
		expect(sameAccount(a, b)).toBe(true);
		expect(sameIdentity(a, b)).toBe(false);
	});

	it("matches equal identities", () => {
		expect(sameIdentity(a, { state: "signed-in", user: { ...user } })).toBe(true);
		expect(sameIdentity({ state: "unknown" }, { state: "unknown" })).toBe(true);
	});

	it("tells states apart", () => {
		expect(sameAccount(a, { state: "signed-out" })).toBe(false);
		expect(sameAccount({ state: "signed-out" }, { state: "signed-out" })).toBe(true);
		expect(sameIdentity({ state: "unknown" }, { state: "signed-out" })).toBe(false);
	});

	it("tells accounts apart by id", () => {
		expect(sameAccount(a, { state: "signed-in", user: { ...user, id: "other" } })).toBe(false);
	});
});
