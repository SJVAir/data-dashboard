import { z } from "$lib/zod";

export const accountUserSchema = z.object({
	id: z.string().min(1),
	full_name: z.string(),
	email: z.string().nullable(),
	phone: z.string().nullable(),
	phone_verified: z.boolean(),
	language: z.string()
});

export type AccountUser = z.infer<typeof accountUserSchema>;

export type Identity =
	{ state: "unknown" } | { state: "signed-out" } | { state: "signed-in"; user: AccountUser };

const blockSchema = z.object({
	v: z.literal(1),
	user: accountUserSchema.nullable()
});

/** Parse the page's `sjvair-identity` JSON block. Never throws. */
export function parseIdentityBlock(text: string): { identity: Identity; unreadable: boolean } {
	try {
		const result = blockSchema.safeParse(JSON.parse(text));
		if (result.success) {
			const { user } = result.data;
			return {
				identity: user ? { state: "signed-in", user } : { state: "signed-out" },
				unreadable: false
			};
		}
	} catch {
		// fall through to unreadable
	}
	return { identity: { state: "signed-out" }, unreadable: true };
}

/** Same state and, when signed in, the same account id. */
export function sameAccount(a: Identity, b: Identity): boolean {
	if (a.state !== b.state) return false;
	if (a.state === "signed-in" && b.state === "signed-in") return a.user.id === b.user.id;
	return true;
}

/** Deep equality: state and every user field. */
export function sameIdentity(a: Identity, b: Identity): boolean {
	if (!sameAccount(a, b)) return false;
	if (a.state === "signed-in" && b.state === "signed-in") {
		const keys = Object.keys(accountUserSchema.shape) as (keyof AccountUser)[];
		return keys.every((key) => a.user[key] === b.user[key]);
	}
	return true;
}
