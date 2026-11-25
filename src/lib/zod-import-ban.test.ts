import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });
const MESSAGE = 'Import `z` from "$lib/zod"';

async function lint(code: string, filePath = "src/lib/x.ts") {
	const [result] = await eslint.lintText(code, { filePath });
	// Only the ban's own rules: the snippets leave their imports unused.
	return result.messages.filter((m) => m.ruleId?.startsWith("no-restricted-"));
}

describe("the zod import ban", () => {
	it.each([
		'import { z } from "zod";',
		'import * as m from "zod/mini";',
		'import("zod");',
		'import("zod/v4");'
	])("refuses %s", async (code) => {
		const messages = await lint(code);
		expect(messages).toHaveLength(1);
		expect(messages[0].message).toContain(MESSAGE);
	});

	it("allows $lib/zod", async () => {
		expect(await lint('import { z } from "$lib/zod";')).toEqual([]);
	});

	it("allows src/lib/zod.ts to import zod", async () => {
		expect(await lint('import { z } from "zod";', "src/lib/zod.ts")).toEqual([]);
	});
});
