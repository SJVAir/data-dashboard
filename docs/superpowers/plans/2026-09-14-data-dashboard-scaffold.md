# Data Dashboard Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap the new `data-dashboard` app (Vite + Svelte 5 + TypeScript, Tailwind v4, shadcn-svelte tooling, sv-router) with a working tab-routing skeleton, a tested preferences/URL-state utility layer, and the project's foundational documentation (`CLAUDE.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `TODO.md`).

**Architecture:** A plain Vite SPA (no SvelteKit, no server runtime), mirroring `monitor-map`'s toolchain but without its widget/Django-embedding build modes or library-packaging setup, since this app is a standalone deployable, not an embeddable library. Three top-level tabs (Monitors, HMS Smoke/Fire, Collocation Sites) are routed via `sv-router`, each currently a placeholder — their real content is separate, later plans. A small, framework-agnostic, unit-tested utility layer (`src/lib/preferences.ts`, `src/lib/url-state.ts`) provides the building blocks for the URL-as-source-of-truth + localStorage-default state architecture described in the spec; later tab plans wire these into `sv-router`'s reactive `route.search`/`searchParams`.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vite, `sv-router`, Tailwind CSS v4, shadcn-svelte tooling (bits-ui, tailwind-merge, tailwind-variants, `@internationalized/date`), `@lucide/svelte`, `date-fns`, `@sveltejs/enhanced-img`, Vitest (new to this repo — see rationale in Task 2). Repo: `/home/alex/workspace/sjvair/data-dashboard` (already a git repo, currently containing only `docs/`, `.gitignore`, `initial-prompt.txt`).

**Spec:** `docs/superpowers/specs/2026-09-14-data-dashboard-v1-design.md`

## Global Constraints

- Tabs for indentation (not spaces); double quotes for strings; no trailing commas; 100-character print width (Prettier config, matching `monitor-map`'s convention — copied verbatim into this repo in Task 1).
- Svelte 5 runes only (`$state`, `$derived`/`$derived.by()`, `$effect`) — no legacy reactive statements (`$:`) or stores for component-local state.
- Tailwind CSS v4 utility classes; no custom `<style>` blocks unless a Tailwind arbitrary-value class truly can't express the rule.
- No SvelteKit, no server-side rendering — this is a client-only SPA (keeps a future Tauri wrap simple).
- Three top-level tabs only in this plan: Monitors (`/`), HMS Smoke/Fire (`/hms`), Collocation Sites (`/collocation-sites`). Their real content (data fetching, date range, county filter, map/chart/spreadsheet views) is explicitly out of scope for this plan — separate plans build each tab.
- The URL is the source of truth for current view state; a localStorage-backed preferences store only ever seeds defaults when no URL params are present. This plan builds the reusable primitives for that (Task 2); it does not yet wire them into a real tab, since no tab has real state to persist yet.
- `@sjvair/monitor-map` is now published at v3.3.0 with a public `MapShell` component (see its `CLAUDE.md`) for future map-view integration — not a dependency of this plan, but relevant context for later tab plans.
- A `.env` file already exists at the repo root (created by the user, gitignored, never to be read into a commit or printed verbatim in any report) containing `VITE_DEV_URL`, `VITE_PROD_URL`, `VITE_MAPTILER_KEY`, `VITE_NREL_KEY`, `VITE_OPENWEATHERMAP_KEY`, and `VITE_CARBONMAPPER_KEY`. This task wires up `VITE_DEV_URL`/`VITE_PROD_URL` (via `@sjvair/sdk`'s `setOrigin`) since the SDK dependency and its origin selection belong in the scaffold; the map-related keys (`VITE_MAPTILER_KEY`/`VITE_NREL_KEY`/`VITE_OPENWEATHERMAP_KEY`) and `VITE_CARBONMAPPER_KEY` are consumed by later plans (map integration, and whatever future data source needs Carbon Mapper) but are still documented in `.env.example` now so the example file matches what a real `.env` in this repo actually needs.

---

### Task 1: Project scaffolding and tab-routing skeleton

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `svelte.config.js`
- Create: `eslint.config.js`
- Create: `.prettierrc`
- Create: `.npmrc`
- Modify: `.gitignore`
- Create: `.env.example`
- Create: `index.html`
- Create: `src/app.css`
- Create: `components.json`
- Create: `src/lib/utils.ts`
- Create: `src/vite-env.d.ts`
- Create: `src/main.ts`
- Create: `src/App.svelte`
- Create: `src/router.ts`
- Create: `src/routes/MonitorsTab.svelte`
- Create: `src/routes/HmsTab.svelte`
- Create: `src/routes/CollocationSitesTab.svelte`

**Interfaces:**
- Produces: `src/router.ts` exports `{ route, navigate, p, isActive }` (the `sv-router` `createRouter` result for this app's route tree: `"/"` → `MonitorsTab`, `"/hms"` → `HmsTab`, `"/collocation-sites"` → `CollocationSitesTab`). `src/lib/utils.ts` exports `cn(...inputs: ClassValue[]): string`. Later plans (Monitors/HMS/Collocation tabs) import `p`/`isActive`/`route`/`navigate` from `./router` (or `../router` depending on file location) and replace the placeholder contents of the three tab `.svelte` files. `src/main.ts` calls `@sjvair/sdk`'s `setOrigin` with `VITE_DEV_URL`/`VITE_PROD_URL` before mounting the app, so any later code calling into `@sjvair/sdk` is already pointed at the right API origin.
- Consumes: nothing from other tasks in this plan (this is the first task). Reads (but never modifies, commits, or prints the contents of) the pre-existing, gitignored `.env` file at the repo root — see the Global Constraints note on it.

- [ ] **Step 1: Create `package.json`**

```json
{
	"name": "@sjvair/data-dashboard",
	"description": "SJVAir's data exploration dashboard",
	"version": "0.1.0",
	"private": true,
	"repository": {
		"type": "git",
		"url": "https://github.com/SJVAir/data-dashboard"
	},
	"type": "module",
	"scripts": {
		"dev": "vite dev",
		"build": "vite build",
		"preview": "vite preview",
		"check": "svelte-check --tsconfig ./tsconfig.json",
		"check:watch": "svelte-check --tsconfig ./tsconfig.json --watch",
		"test": "vitest run",
		"test:watch": "vitest",
		"format": "prettier --write .",
		"lint": "prettier --check . && eslint ."
	},
	"devDependencies": {
		"@eslint/compat": "^2.1.1",
		"@eslint/js": "^10.0.1",
		"@fontsource-variable/inter": "^5.3.0",
		"@internationalized/date": "^3.12.4",
		"@sveltejs/enhanced-img": "^0.11.0",
		"@sveltejs/vite-plugin-svelte": "^7.3.0",
		"@tailwindcss/vite": "^4.3.3",
		"@types/node": "^26.5.1",
		"eslint": "^10.10.0",
		"eslint-config-prettier": "^10.1.8",
		"eslint-plugin-svelte": "^3.23.0",
		"globals": "^17.12.0",
		"prettier": "^3.9.6",
		"prettier-plugin-svelte": "^4.1.1",
		"prettier-plugin-tailwindcss": "^0.8.1",
		"shadcn-svelte": "^1.6.1",
		"svelte": "^5.57.0",
		"svelte-check": "^4.7.6",
		"tailwindcss": "^4.3.3",
		"tw-animate-css": "^1.4.0",
		"typescript": "^7.0.2",
		"typescript-eslint": "^8.70.0",
		"vite": "^8.3.0",
		"vitest": "^5.0.0"
	},
	"dependencies": {
		"@lucide/svelte": "^1.46.0",
		"@sjvair/sdk": "npm:@jsr/sjvair__sdk@^3.2.0",
		"bits-ui": "^2.19.2",
		"clsx": "^2.1.1",
		"date-fns": "^4.4.0",
		"sv-router": "^0.19.0",
		"tailwind-merge": "^3.7.0",
		"tailwind-variants": "^3.3.1"
	}
}
```

(`@sjvair/sdk` is JSR-published; resolving the `npm:@jsr/sjvair__sdk` alias requires the `.npmrc` created in Step 6a below.)

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
	"compilerOptions": {
		"allowJs": true,
		"checkJs": true,
		"esModuleInterop": true,
		"forceConsistentCasingInFileNames": true,
		"resolveJsonModule": true,
		"skipLibCheck": true,
		"sourceMap": true,
		"strict": true,
		"module": "esnext",
		"moduleResolution": "bundler",
		"experimentalDecorators": false,
		"target": "es2024",
		"allowImportingTsExtensions": true,
		"noEmit": true,
		"lib": ["esnext", "dom", "dom.iterable"],
		"paths": {
			"$lib": ["./src/lib"],
			"$lib/*": ["./src/lib/*"]
		}
	},
	"include": ["src/**/*.ts", "src/**/*.svelte", "vite.config.ts"],
	"exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create `vite.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import tailwindcss from "@tailwindcss/vite";
import { enhancedImages } from "@sveltejs/enhanced-img";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
	plugins: [tailwindcss(), enhancedImages(), svelte()],
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL("./src/lib", import.meta.url))
		}
	},
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"]
	}
});
```

(Using `vitest/config`'s `defineConfig` instead of plain `vite`'s gives typed `test` options on the same config object Vite itself uses — no separate `vitest.config.ts` needed.)

- [ ] **Step 4: Create `svelte.config.js`**

```js
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const config = {
	preprocess: vitePreprocess()
};

export default config;
```

- [ ] **Step 5: Create `eslint.config.js`**

```js
import { defineConfig } from "eslint/config";
import prettier from "eslint-config-prettier";
import js from "@eslint/js";
import { includeIgnoreFile } from "@eslint/compat";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import { fileURLToPath } from "node:url";
import ts from "typescript-eslint";
import svelteConfig from "./svelte.config.js";

const gitignorePath = fileURLToPath(new URL("./.gitignore", import.meta.url));

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs["flat/recommended"],
	prettier,
	svelte.configs["flat/prettier"],
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node
			}
		}
	},
	{
		files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: [".svelte"],
				parser: ts.parser,
				svelteConfig
			}
		}
	}
);
```

- [ ] **Step 6a: Create `.npmrc`**

```
@jsr:registry=https://npm.jsr.io
allow-remote=root
```

(Matches `monitor-map`'s `.npmrc` — required for the `npm:@jsr/sjvair__sdk` alias in `package.json` to resolve. `allow-remote=root` matches this sandboxed dev environment; keep it for parity with the sibling repos even if not strictly needed elsewhere.)

- [ ] **Step 6: Create `.prettierrc`**

```json
{
	"useTabs": true,
	"singleQuote": false,
	"trailingComma": "none",
	"printWidth": 100,
	"plugins": ["prettier-plugin-svelte", "prettier-plugin-tailwindcss"],
	"overrides": [
		{
			"files": "*.svelte",
			"options": {
				"parser": "svelte"
			}
		}
	]
}
```

- [ ] **Step 7: Update `.gitignore`**

Replace its entire contents with:

```
node_modules

# Output
.output
.vercel
.netlify
.wrangler
/build
/dist

# OS
.DS_Store
Thumbs.db

# Env
.env
.env.*
!.env.example
!.env.test

# Vite
vite.config.js.timestamp-*
vite.config.ts.timestamp-*

# Superpowers workspace
.superpowers/
```

(`.env` is already excluded, `.env.example` already allowed, by the existing `# Env` block above — no change needed there beyond what's already written.)

- [ ] **Step 7a: Create `.env.example`**

```
VITE_DEV_URL=http://localhost:8000
VITE_PROD_URL=https://www.sjvair.com
VITE_MAPTILER_KEY=
VITE_NREL_KEY=
VITE_OPENWEATHERMAP_KEY=
VITE_CARBONMAPPER_KEY=
```

(Documents every variable a real `.env` in this repo needs. `VITE_DEV_URL`/`VITE_PROD_URL` are consumed in this task (Step 15a below); the rest are placeholders for later plans — do not fill in real values here, this file is committed.)

- [ ] **Step 8: Create `index.html`**

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>SJVAir Data Dashboard</title>
	</head>
	<body>
		<div id="app"></div>
		<script type="module" src="/src/main.ts"></script>
	</body>
</html>
```

- [ ] **Step 9: Create `src/app.css`**

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn-svelte/tailwind.css";
@import "@fontsource-variable/inter";

@custom-variant dark (&:is(.dark *));

@theme {
	--breakpoint-xs: 25rem;
	--font-sans: "Inter Variable", sans-serif;
	--color-sidebar-ring: var(--sidebar-ring);
	--color-sidebar-border: var(--sidebar-border);
	--color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
	--color-sidebar-accent: var(--sidebar-accent);
	--color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
	--color-sidebar-primary: var(--sidebar-primary);
	--color-sidebar-foreground: var(--sidebar-foreground);
	--color-sidebar: var(--sidebar);
	--color-chart-5: var(--chart-5);
	--color-chart-4: var(--chart-4);
	--color-chart-3: var(--chart-3);
	--color-chart-2: var(--chart-2);
	--color-chart-1: var(--chart-1);
	--color-ring: var(--ring);
	--color-input: var(--input);
	--color-border: var(--border);
	--color-destructive: var(--destructive);
	--color-accent-foreground: var(--accent-foreground);
	--color-accent: var(--accent);
	--color-muted-foreground: var(--muted-foreground);
	--color-muted: var(--muted);
	--color-secondary-foreground: var(--secondary-foreground);
	--color-secondary: var(--secondary);
	--color-primary-foreground: var(--primary-foreground);
	--color-primary: var(--primary);
	--color-popover-foreground: var(--popover-foreground);
	--color-popover: var(--popover);
	--color-card-foreground: var(--card-foreground);
	--color-card: var(--card);
	--color-foreground: var(--foreground);
	--color-background: var(--background);
	--radius-sm: calc(var(--radius) * 0.6);
	--radius-md: calc(var(--radius) * 0.8);
	--radius-lg: var(--radius);
	--radius-xl: calc(var(--radius) * 1.4);
	--radius-2xl: calc(var(--radius) * 1.8);
	--radius-3xl: calc(var(--radius) * 2.2);
	--radius-4xl: calc(var(--radius) * 2.6);
}

:root {
	--background: oklch(1 0 0);
	--foreground: oklch(0.145 0 0);
	--card: oklch(1 0 0);
	--card-foreground: oklch(0.145 0 0);
	--popover: oklch(1 0 0);
	--popover-foreground: oklch(0.145 0 0);
	--primary: oklch(0.205 0 0);
	--primary-foreground: oklch(0.985 0 0);
	--secondary: oklch(0.97 0 0);
	--secondary-foreground: oklch(0.205 0 0);
	--muted: oklch(0.97 0 0);
	--muted-foreground: oklch(0.556 0 0);
	--accent: oklch(0.97 0 0);
	--accent-foreground: oklch(0.205 0 0);
	--destructive: oklch(0.577 0.245 27.325);
	--border: oklch(0.922 0 0);
	--input: oklch(0.922 0 0);
	--ring: oklch(0.708 0 0);
	--chart-1: oklch(0.87 0 0);
	--chart-2: oklch(0.556 0 0);
	--chart-3: oklch(0.439 0 0);
	--chart-4: oklch(0.371 0 0);
	--chart-5: oklch(0.269 0 0);
	--radius: 0.625rem;
	--sidebar: oklch(0.985 0 0);
	--sidebar-foreground: oklch(0.145 0 0);
	--sidebar-primary: oklch(0.205 0 0);
	--sidebar-primary-foreground: oklch(0.985 0 0);
	--sidebar-accent: oklch(0.97 0 0);
	--sidebar-accent-foreground: oklch(0.205 0 0);
	--sidebar-border: oklch(0.922 0 0);
	--sidebar-ring: oklch(0.708 0 0);
}

.dark {
	--background: oklch(0.145 0 0);
	--foreground: oklch(0.985 0 0);
	--card: oklch(0.205 0 0);
	--card-foreground: oklch(0.985 0 0);
	--popover: oklch(0.205 0 0);
	--popover-foreground: oklch(0.985 0 0);
	--primary: oklch(0.922 0 0);
	--primary-foreground: oklch(0.205 0 0);
	--secondary: oklch(0.269 0 0);
	--secondary-foreground: oklch(0.985 0 0);
	--muted: oklch(0.269 0 0);
	--muted-foreground: oklch(0.708 0 0);
	--accent: oklch(0.269 0 0);
	--accent-foreground: oklch(0.985 0 0);
	--destructive: oklch(0.704 0.191 22.216);
	--border: oklch(1 0 0 / 10%);
	--input: oklch(1 0 0 / 15%);
	--ring: oklch(0.556 0 0);
	--chart-1: oklch(0.87 0 0);
	--chart-2: oklch(0.556 0 0);
	--chart-3: oklch(0.439 0 0);
	--chart-4: oklch(0.371 0 0);
	--chart-5: oklch(0.269 0 0);
	--sidebar: oklch(0.205 0 0);
	--sidebar-foreground: oklch(0.985 0 0);
	--sidebar-primary: oklch(0.488 0.243 264.376);
	--sidebar-primary-foreground: oklch(0.985 0 0);
	--sidebar-accent: oklch(0.269 0 0);
	--sidebar-accent-foreground: oklch(0.985 0 0);
	--sidebar-border: oklch(1 0 0 / 10%);
	--sidebar-ring: oklch(0.556 0 0);
}

@layer base {
	* {
		@apply border-border outline-ring/50;
	}
	body {
		@apply bg-background text-foreground;
	}
	html {
		@apply font-sans;
	}
}
```

(This is `monitor-map`'s shadcn/Tailwind v4 theme token set, minus its map-widget-specific brand color extras and `.svg-icon` mask-icon block, which don't apply here. Brand colors/visual design are explicitly out of scope for this plan per the spec — "All initial design ideas are up for debate.")

- [ ] **Step 10: Create `components.json`**

```json
{
	"$schema": "https://shadcn-svelte.com/schema.json",
	"tailwind": {
		"css": "src/app.css",
		"baseColor": "neutral"
	},
	"aliases": {
		"components": "$lib/components",
		"utils": "$lib/utils",
		"ui": "$lib/components/ui",
		"hooks": "$lib/hooks",
		"lib": "$lib"
	},
	"typescript": true,
	"registry": "https://shadcn-svelte.com/registry",
	"style": "nova",
	"iconLibrary": "lucide"
}
```

This lets later plans run `npx shadcn-svelte add <component>` to pull in actual shadcn-svelte UI components as tabs need them — no UI components are hand-authored in this task.

- [ ] **Step 11: Create `src/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}
```

- [ ] **Step 11a: Create `src/vite-env.d.ts`**

```ts
/// <reference types="svelte" />
/// <reference types="vite/client" />
```

(Required for `import.meta.env.VITE_DEV_URL`/`VITE_PROD_URL` — used in Step 15's `src/main.ts` — to type-check at all; without this, TypeScript doesn't know about Vite's `import.meta.env`. Matches `monitor-map`'s own `src/vite-env.d.ts`.)

- [ ] **Step 12: Create the three placeholder tab components**

`src/routes/MonitorsTab.svelte`:

```svelte
<div class="p-4">
	<h1 class="text-xl font-bold">Monitors</h1>
	<p class="text-muted-foreground">Monitor data exploration is coming soon.</p>
</div>
```

`src/routes/HmsTab.svelte`:

```svelte
<div class="p-4">
	<h1 class="text-xl font-bold">HMS Smoke/Fire</h1>
	<p class="text-muted-foreground">HMS smoke and fire data exploration is coming soon.</p>
</div>
```

`src/routes/CollocationSitesTab.svelte`:

```svelte
<div class="p-4">
	<h1 class="text-xl font-bold">Collocation Sites</h1>
	<p class="text-muted-foreground">Collocation site comparison is coming soon.</p>
</div>
```

- [ ] **Step 13: Create `src/router.ts`**

```ts
import { createRouter } from "sv-router";
import MonitorsTab from "./routes/MonitorsTab.svelte";
import HmsTab from "./routes/HmsTab.svelte";
import CollocationSitesTab from "./routes/CollocationSitesTab.svelte";

export const { route, navigate, p, isActive } = createRouter({
	"/": MonitorsTab,
	"/hms": HmsTab,
	"/collocation-sites": CollocationSitesTab
});
```

- [ ] **Step 14: Create `src/App.svelte`**

```svelte
<script lang="ts">
	import { Router } from "sv-router";
	import { p, isActive } from "./router";
</script>

<div class="flex h-screen w-screen flex-col">
	<nav class="flex gap-4 border-b border-border px-4 py-2" aria-label="Data type">
		<a href={p("/")} class="font-medium" class:underline={isActive("/")}>Monitors</a>
		<a href={p("/hms")} class="font-medium" class:underline={isActive("/hms")}>HMS Smoke/Fire</a>
		<a
			href={p("/collocation-sites")}
			class="font-medium"
			class:underline={isActive("/collocation-sites")}>Collocation Sites</a
		>
	</nav>
	<main class="flex-1 overflow-auto">
		<Router />
	</main>
</div>
```

- [ ] **Step 15: Create `src/main.ts`**

```ts
import { mount } from "svelte";
import { setOrigin } from "@sjvair/sdk/http";
import "./app.css";
import App from "./App.svelte";

if (import.meta.env.PROD) {
	setOrigin(import.meta.env.VITE_PROD_URL);
} else {
	setOrigin(import.meta.env.VITE_DEV_URL);
}

mount(App, { target: document.getElementById("app")! });
```

(Mirrors `monitor-map`'s `src/main.ts` pattern, but reads the origin from `VITE_DEV_URL`/`VITE_PROD_URL` — set in the repo's gitignored `.env` — instead of a hardcoded `http://localhost:8000`, since this app isn't tied to a fixed local server port the way `monitor-map`'s dev workflow is.)

- [ ] **Step 15a: Verify the SDK import resolves**

Run: `npx tsc --noEmit -p tsconfig.json` (or wait for Step 17's full `npm run check`, which covers this) — confirms `@sjvair/sdk/http`'s `setOrigin` type-checks against the version installed in Step 16.

- [ ] **Step 16: Install dependencies**

Run: `npm install`
Expected: completes without errors. (If a native-module build step fails in a sandboxed environment the way `sharp`'s did in `monitor-map`'s worktree during the prior plan, and a working `node_modules` from a sibling checkout exists, copying it is an acceptable workaround — but try `npm install` first, since this is a fresh repo with no such sibling checkout.)

- [ ] **Step 17: Run the type checker**

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 18: Run lint**

Run: `npm run lint`
Expected: passes. If it flags formatting, run `npm run format` and re-check.

- [ ] **Step 19: Manual smoke test in the dev server**

Run: `npm run dev`, open the printed local URL, and verify:
- The page loads showing a nav bar with "Monitors", "HMS Smoke/Fire", and "Collocation Sites" links, and the Monitors placeholder content below it (since `/` routes to `MonitorsTab`).
- Clicking "HMS Smoke/Fire" navigates to `/hms` and shows its placeholder content; the "HMS Smoke/Fire" link becomes underlined (active) and "Monitors" is no longer underlined.
- Clicking "Collocation Sites" navigates to `/collocation-sites` and shows its placeholder content, with that link underlined.
- Browser back/forward navigation works between the three tabs without a full page reload.

- [ ] **Step 20: Run a production build**

Run: `npm run build`
Expected: succeeds, producing a `dist/` directory.

- [ ] **Step 21: Commit**

```bash
cd /home/alex/workspace/sjvair/data-dashboard
git add package.json tsconfig.json vite.config.ts svelte.config.js eslint.config.js .prettierrc .npmrc .gitignore .env.example index.html src components.json package-lock.json
git commit -m "Scaffold Vite/Svelte app with tab-routing skeleton"
```

Before running `git add`, double-check with `git status` that the real `.env` file is NOT staged (it must show as ignored, not untracked) — if it appears, stop and report this as a concern rather than committing it.

(`package-lock.json` is created by `npm install` in Step 16 — include it.)

---

### Task 2: Preferences store and URL-state codec utilities

**Files:**
- Create: `src/lib/preferences.ts`
- Create: `src/lib/preferences.test.ts`
- Create: `src/lib/url-state.ts`
- Create: `src/lib/url-state.test.ts`

**Interfaces:**
- Produces: `getTabPreferences(tabId: string): TabPreferences`, `setTabPreferences(tabId: string, prefs: TabPreferences): void`, `clearAllPreferences(): void`, and types `ViewToggles`/`TabPreferences` from `src/lib/preferences.ts`. `encodeDateRange(range: DateRangeParam): string`, `decodeDateRange(value: string | null | undefined): DateRangeParam | null`, `encodeViews(views: Record<string, boolean>): string`, `decodeViews<K extends string>(value: string | null | undefined, allKeys: readonly K[]): Record<K, boolean>`, and type `DateRangeParam` from `src/lib/url-state.ts`. Later tab plans call these directly (e.g. `getTabPreferences("monitors")` to seed defaults, `decodeDateRange(route.search.range)`/`searchParams.set("range", encodeDateRange(...))` to wire the codec to `sv-router`'s reactive search params) — that wiring is NOT done in this task, since no real tab consumes it yet.
- Consumes: nothing from Task 1 (these are standalone modules with no `sv-router` or Svelte dependency, verified by pure Vitest unit tests rather than the dev server).

**Why Vitest, when `monitor-map` has no test framework:** `monitor-map`'s codebase is almost entirely DOM/map-integration code with no established test convention to follow. This module is the opposite — pure, framework-agnostic serialization logic with no DOM dependency — exactly what unit tests are for, and this is a brand-new repo with no existing "no tests" convention to inherit. Vitest is the idiomatic choice for a Vite+TypeScript project.

- [ ] **Step 1: Write the failing tests for `src/lib/preferences.ts`**

Create `src/lib/preferences.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { clearAllPreferences, getTabPreferences, setTabPreferences } from "./preferences";

function createMemoryStorage(): Storage {
	const store = new Map<string, string>();
	return {
		getItem: (key) => store.get(key) ?? null,
		setItem: (key, value) => {
			store.set(key, value);
		},
		removeItem: (key) => {
			store.delete(key);
		},
		clear: () => store.clear(),
		key: (index) => Array.from(store.keys())[index] ?? null,
		get length() {
			return store.size;
		}
	};
}

beforeEach(() => {
	globalThis.localStorage = createMemoryStorage();
});

describe("preferences", () => {
	it("returns an empty object for a tab with no stored preferences", () => {
		expect(getTabPreferences("monitors")).toEqual({});
	});

	it("persists and retrieves preferences for a tab", () => {
		setTabPreferences("monitors", { dateRange: { start: "2026-01-01", end: "2026-01-02" } });
		expect(getTabPreferences("monitors")).toEqual({
			dateRange: { start: "2026-01-01", end: "2026-01-02" }
		});
	});

	it("keeps preferences for different tabs independent", () => {
		setTabPreferences("monitors", { views: { map: true, chart: false, spreadsheet: false } });
		setTabPreferences("hms", { views: { map: false, chart: true, spreadsheet: true } });
		expect(getTabPreferences("monitors").views).toEqual({
			map: true,
			chart: false,
			spreadsheet: false
		});
		expect(getTabPreferences("hms").views).toEqual({ map: false, chart: true, spreadsheet: true });
	});

	it("merges partial updates instead of overwriting the whole tab", () => {
		setTabPreferences("monitors", { dateRange: { start: "2026-01-01", end: "2026-01-02" } });
		setTabPreferences("monitors", { views: { map: true, chart: true, spreadsheet: false } });
		expect(getTabPreferences("monitors")).toEqual({
			dateRange: { start: "2026-01-01", end: "2026-01-02" },
			views: { map: true, chart: true, spreadsheet: false }
		});
	});

	it("clearAllPreferences removes all stored data", () => {
		setTabPreferences("monitors", { dateRange: { start: "2026-01-01", end: "2026-01-02" } });
		clearAllPreferences();
		expect(getTabPreferences("monitors")).toEqual({});
	});

	it("recovers from corrupted JSON in storage instead of throwing", () => {
		localStorage.setItem("sjvair-dashboard-preferences", "{not json");
		expect(getTabPreferences("monitors")).toEqual({});
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/preferences.test.ts`
Expected: FAIL — `src/lib/preferences.ts` does not exist yet, so the import fails.

- [ ] **Step 3: Implement `src/lib/preferences.ts`**

```ts
export interface ViewToggles {
	map: boolean;
	chart: boolean;
	spreadsheet: boolean;
}

export interface TabPreferences {
	dateRange?: { start: string; end: string };
	views?: ViewToggles;
}

interface PreferencesData {
	tabs: Record<string, TabPreferences>;
}

const STORAGE_KEY = "sjvair-dashboard-preferences";

function hasLocalStorage(): boolean {
	return typeof localStorage !== "undefined";
}

function readAll(): PreferencesData {
	if (!hasLocalStorage()) return { tabs: {} };
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { tabs: {} };
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === "object" && "tabs" in parsed) {
			return parsed as PreferencesData;
		}
		return { tabs: {} };
	} catch {
		return { tabs: {} };
	}
}

function writeAll(data: PreferencesData): void {
	if (!hasLocalStorage()) return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function getTabPreferences(tabId: string): TabPreferences {
	return readAll().tabs[tabId] ?? {};
}

export function setTabPreferences(tabId: string, prefs: TabPreferences): void {
	const data = readAll();
	data.tabs[tabId] = { ...data.tabs[tabId], ...prefs };
	writeAll(data);
}

export function clearAllPreferences(): void {
	if (!hasLocalStorage()) return;
	localStorage.removeItem(STORAGE_KEY);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/preferences.test.ts`
Expected: PASS, 6/6 tests.

- [ ] **Step 5: Write the failing tests for `src/lib/url-state.ts`**

Create `src/lib/url-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decodeDateRange, decodeViews, encodeDateRange, encodeViews } from "./url-state";

describe("date range codec", () => {
	it("round-trips a date range through encode and decode", () => {
		const range = { start: "2026-01-01", end: "2026-01-31" };
		expect(decodeDateRange(encodeDateRange(range))).toEqual(range);
	});

	it("decodes null as no date range", () => {
		expect(decodeDateRange(null)).toBeNull();
	});

	it("decodes undefined as no date range", () => {
		expect(decodeDateRange(undefined)).toBeNull();
	});

	it("decodes an empty string as no date range", () => {
		expect(decodeDateRange("")).toBeNull();
	});

	it("decodes a malformed value (missing separator) as no date range", () => {
		expect(decodeDateRange("2026-01-01")).toBeNull();
	});
});

describe("views codec", () => {
	const allViews = ["map", "chart", "spreadsheet"] as const;

	it("round-trips enabled views through encode and decode", () => {
		const views = { map: true, chart: false, spreadsheet: true };
		expect(decodeViews(encodeViews(views), allViews)).toEqual(views);
	});

	it("decodes null as all views disabled", () => {
		expect(decodeViews(null, allViews)).toEqual({ map: false, chart: false, spreadsheet: false });
	});

	it("encodes no enabled views as an empty string", () => {
		expect(encodeViews({ map: false, chart: false, spreadsheet: false })).toBe("");
	});

	it("ignores unknown keys when decoding", () => {
		expect(decodeViews("map,unknown", allViews)).toEqual({
			map: true,
			chart: false,
			spreadsheet: false
		});
	});
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npx vitest run src/lib/url-state.test.ts`
Expected: FAIL — `src/lib/url-state.ts` does not exist yet.

- [ ] **Step 7: Implement `src/lib/url-state.ts`**

```ts
export interface DateRangeParam {
	start: string;
	end: string;
}

const DATE_RANGE_SEPARATOR = "..";

export function encodeDateRange(range: DateRangeParam): string {
	return `${range.start}${DATE_RANGE_SEPARATOR}${range.end}`;
}

export function decodeDateRange(value: string | null | undefined): DateRangeParam | null {
	if (!value) return null;
	const [start, end] = value.split(DATE_RANGE_SEPARATOR);
	if (!start || !end) return null;
	return { start, end };
}

export function encodeViews(views: Record<string, boolean>): string {
	return Object.entries(views)
		.filter(([, enabled]) => enabled)
		.map(([key]) => key)
		.join(",");
}

export function decodeViews<K extends string>(
	value: string | null | undefined,
	allKeys: readonly K[]
): Record<K, boolean> {
	const enabled = new Set((value ?? "").split(",").filter(Boolean));
	return Object.fromEntries(allKeys.map((key) => [key, enabled.has(key)])) as Record<K, boolean>;
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/lib/url-state.test.ts`
Expected: PASS, 9/9 tests.

- [ ] **Step 9: Run the full test suite, type checker, and lint**

Run: `npm run test`
Expected: PASS, 15/15 tests total, output pristine (no warnings).

Run: `npm run check`
Expected: 0 errors.

Run: `npm run lint`
Expected: passes.

- [ ] **Step 10: Commit**

```bash
cd /home/alex/workspace/sjvair/data-dashboard
git add src/lib/preferences.ts src/lib/preferences.test.ts src/lib/url-state.ts src/lib/url-state.test.ts
git commit -m "Add preferences store and URL-state codec utilities"
```

---

### Task 3: Project documentation

**Files:**
- Create: `CLAUDE.md`
- Create: `ARCHITECTURE.md`
- Create: `ROADMAP.md`
- Create: `TODO.md`

**Interfaces:**
- Consumes: the app structure from Task 1 (`src/router.ts`, `src/App.svelte`, tab file names) and the utilities from Task 2 (`src/lib/preferences.ts`, `src/lib/url-state.ts`), described accurately in the docs below.
- Produces: nothing code-level; these are the project's persistent reference docs for future work (both human and agentic).

- [ ] **Step 1: Create `CLAUDE.md`**

```markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SJVAir's data exploration dashboard — a Vite + Svelte 5 SPA for browsing and comparing
the SJVAir ecosystem's data sets (air monitors, HMS smoke/fire, collocation sites).
See `ARCHITECTURE.md` for the full design and `ROADMAP.md` for what's deliberately
deferred past v1.

## Commands

\`\`\`bash
npm run dev          # Start development server
npm run build        # Production build
npm run preview      # Preview production build
npm run check        # Type-check Svelte components
npm run check:watch  # Type-check in watch mode
npm run test         # Run the Vitest suite once
npm run test:watch   # Run Vitest in watch mode
npm run lint         # Prettier check + ESLint
npm run format       # Auto-format with Prettier
\`\`\`

## Architecture Overview

Plain Vite SPA — no SvelteKit, no server-side rendering. Routing is handled by
`sv-router` (`src/router.ts` exports `{ route, navigate, p, isActive }`; `src/App.svelte`
renders the nav and `<Router />`). Each top-level tab is a route under `src/routes/`.

### State architecture

- **URL is the source of truth** for the current view (active tab, filters, date
  range, which views are toggled on) — see `ARCHITECTURE.md` for the full rationale.
- **`src/lib/preferences.ts`** is a localStorage-backed store of *defaults* only
  (`getTabPreferences`/`setTabPreferences`/`clearAllPreferences`), used to seed the URL
  when a tab is opened with no params present — never to override an existing URL.
- **`src/lib/url-state.ts`** provides pure encode/decode codecs (`encodeDateRange`/
  `decodeDateRange`, `encodeViews`/`decodeViews`) for serializing state into URL search
  params. These are framework-agnostic and unit-tested independently of `sv-router`;
  a tab wires them to `sv-router`'s reactive `route.search`/`searchParams`.

### Related SJVAir projects

- `@sjvair/monitor-map` (sibling repo `../monitor-map`) — SJVAir's interactive map,
  packaged as an embeddable Svelte library. Its `MapShell` component (added in v3.3.0)
  is a reusable, configurable map-layout primitive intended for exactly this kind of
  embedding — see its `CLAUDE.md` for the `routerEscapeHatch`/`basePath` props needed
  when embedding it inside an app with its own routing (like this one).
- `@sjvair/sdk` (sibling repo `../sdk-js`) — the SJVAir API client. Currently covers
  the `monitors` (with `entry_type`s like pm25/pm10/o3/etc.), `hms` (smoke/fire), and
  `collocation_sites` domains.

## Key Libraries

| Library                    | Purpose                                  |
| --------------------------- | ----------------------------------------- |
| `sv-router`                 | Client-side routing                       |
| `@sjvair/sdk`                | Air quality data API                      |
| `@sjvair/monitor-map`        | Embeddable map component (future tab plans) |
| `date-fns`                  | Date handling                             |
| `uplot`                      | Charts (future tab plans)                 |
| shadcn-svelte / bits-ui      | Accessible UI primitives                  |
| `@lucide/svelte`             | Icons                                     |
| Vitest                       | Unit tests for framework-agnostic logic   |

## Environment Variables

Copy `.env.example` to `.env` and fill in real values (never commit `.env` itself):

\`\`\`
VITE_DEV_URL=              # @sjvair/sdk origin used in dev (setOrigin)
VITE_PROD_URL=              # @sjvair/sdk origin used in production builds
VITE_MAPTILER_KEY=          # used by @sjvair/monitor-map's MapShell (future tab plans)
VITE_NREL_KEY=               # used by @sjvair/monitor-map (future tab plans)
VITE_OPENWEATHERMAP_KEY=    # used by @sjvair/monitor-map (future tab plans)
VITE_CARBONMAPPER_KEY=      # reserved for a future data source integration
\`\`\`

## Code Style

- **Tabs** for indentation (not spaces)
- **Double quotes** for strings
- No trailing commas
- Print width: 100 characters
- Prettier + ESLint (flat config); run `npm run format` before committing
- Tailwind CSS v4 for styling; prefer utility classes over custom `<style>` blocks
- Svelte 5 runes only (`$state`, `$derived`, `$effect`) — no legacy `$:` reactive statements
```

- [ ] **Step 2: Create `ARCHITECTURE.md`**

```markdown
# Architecture

This document describes the design of the SJVAir data-exploration dashboard. It
reflects the decisions recorded in
`docs/superpowers/specs/2026-09-14-data-dashboard-v1-design.md`; consult that spec
for the full rationale behind each decision.

## Scope (v1)

Data exploration only: browse each data domain, filter by date range (and, where
applicable, county), and view the result as a map, chart, and/or spreadsheet.
Cross-dataset analysis, server-side location search, server-synced preferences, and
a Tauri desktop build are deliberately out of scope for v1 — see `ROADMAP.md`.

## Repos involved

- **`data-dashboard`** (this repo) — the app itself.
- **`monitor-map`** — provides the embeddable map component (`MapShell`, published
  in `@sjvair/monitor-map` v3.3.0+) used by the Monitors tab's map view.
- **`sdk-js`** (`@sjvair/sdk`) — the API client this app fetches data through.

## Tech stack

Svelte 5 + TypeScript + Vite, `sv-router`, Tailwind CSS v4, shadcn-svelte (bits-ui),
`@lucide/svelte`, `date-fns`, `uplot`, `@sveltejs/enhanced-img`, `@sjvair/sdk`.

No SvelteKit — a plain Vite SPA, matching `monitor-map` and `v3-mobile`, and keeping
a future Tauri wrap simple (pure static client, no server runtime to strip out).

## Tab structure

One top-level tab per SDK data domain, routed via `sv-router`:

- **Monitors** (`/`) — entry_type filter (pm25/pm10/o3/etc., not a sub-tab), date
  range, client-side county filter (using the `county` field already present on
  `MonitorData` — no SDK changes needed). Map, chart, and spreadsheet views, all
  independently toggleable.
- **HMS Smoke/Fire** (`/hms`) — date range filter. Primarily map-centric (GeoJSON
  polygons); chart/spreadsheet toggles may be hidden or disabled for this tab.
- **Collocation Sites** (`/collocation-sites`) — not a date-range + multi-view tab
  like the others. A collocation "site" pairs a reference monitor with a collocated
  monitor, with no time-series data of its own. The flow is: list/map of pairs →
  select a pair → drill into a comparison view of both monitors' entries over a date
  range (reusing the Monitors tab's chart/spreadsheet views against two monitor IDs).

## State & URL architecture

- **The URL is the source of truth** for current view state: active tab,
  entry_type/filters, date range, county filter, and which views (map/chart/
  spreadsheet) are toggled on. Sharing a URL reproduces the exact same screen for the
  recipient, view toggles included.
- **A preferences store** (`src/lib/preferences.ts`; localStorage in v1, server-backed
  sync is a roadmap item) holds only *defaults*: last-used date range and view
  toggles per tab. It seeds the URL only when a tab is opened with no params present
  — not on every navigation. Once URL params exist, they win.
- **`src/lib/url-state.ts`** provides the pure, unit-tested serialization codecs
  (`encodeDateRange`/`decodeDateRange`, `encodeViews`/`decodeViews`) a tab uses to
  read/write its URL search params via `sv-router`'s `route.search`/`searchParams`.
- Each tab owns its own lightweight `*.svelte.ts` manager (mirroring `monitor-map`'s
  `monitorsManager` pattern): fetches from `@sjvair/sdk`, holds `$state`, derives
  view-ready data. These are new, date-ranged/historical-query managers — distinct
  from `monitor-map`'s own managers, which are scoped to "all currently active
  monitors," not arbitrary historical date ranges.

## Views

Rendered as simultaneous split panes when more than one is toggled on (side-by-side
on desktop, stacked on mobile), not switchable sub-tabs.

- **Map** — `@sjvair/monitor-map`'s `MapShell` plus the relevant integration(s) for
  that tab (e.g. the Monitors tab passes `[monitorsMapIntegration]`). `MapShell` must
  be used with `routerEscapeHatch={false}` since this app has its own `sv-router`
  navigation — see `monitor-map`'s `CLAUDE.md`.
- **Chart** — `uplot`, following `monitor-map`'s existing `data-chart` module pattern.
- **Spreadsheet** — read-only, sortable/filterable table with CSV export, preferring
  the SDK's existing CSV entries endpoint over re-serializing fetched JSON client-side
  where the endpoint's shape matches what's displayed.

## Accessibility

- Every view has a non-visual fallback: the spreadsheet view already serves as one
  for chart/map data; map and chart views should expose their underlying data as
  visible summary text or link to the spreadsheet view.
- Keyboard navigation and ARIA labeling via shadcn-svelte's primitives (bits-ui), not
  hand-rolled interactive elements.
- Standard per-view loading/error states (skeleton or spinner while fetching; inline
  error message with retry).

## Out of scope for v1

See `ROADMAP.md`.
```

- [ ] **Step 3: Create `ROADMAP.md`**

```markdown
# Roadmap

## Plan sequence

1. ~~**monitor-map modularization**~~ — done. `MapShell`, a configurable map-layout
   primitive, published in `@sjvair/monitor-map` v3.3.0.
2. **Data dashboard scaffold** (this plan) — app skeleton, tab routing, preferences/
   URL-state utilities, project docs.
3. **Monitors tab** — entry_type/date/county filters, map/chart/spreadsheet views.
4. **HMS Smoke/Fire tab**.
5. **Collocation Sites tab**.

See `docs/superpowers/plans/` for each plan's full task breakdown, and `TODO.md` for
current status.

## Deferred past v1

These are explicitly out of scope until v1 (data exploration across the three tabs
above) ships:

- **Unified "Data Analysis" tab** — select multiple data sets for cross-comparison,
  using common data-science tooling (ideally WebAssembly-backed for heavy
  computation, using an existing WASM library rather than building one). Looks for
  trends and comparisons across data sets.
- **Server-side location/radius search** — the API doesn't yet support querying
  monitors by location/radius; each monitor does carry a `county` field today, which
  v1's Monitors tab uses for client-side filtering, but true geo search requires
  `sdk-js` (and likely server) changes.
- **Server-synced preferences** — v1's preferences store is localStorage-only; syncing
  them to a user's account on the server is a later feature.
- **Tauri desktop build** — the app is being built as a plain Vite SPA (no SvelteKit,
  no server runtime) specifically to keep this feasible later, with extended
  capabilities not practical or worth the cost in-browser.
```

- [ ] **Step 4: Create `TODO.md`**

```markdown
# TODO / Current Status

Last updated: 2026-09-14

## Done

- [x] Brainstormed and wrote the v1 design spec:
      `docs/superpowers/specs/2026-09-14-data-dashboard-v1-design.md`
- [x] **monitor-map modularization** — `MapShell` extracted as a configurable map-layout
      primitive; `MonitorMapLayout` is now a thin wrapper preserving existing behavior.
      Merged as SJVAir/monitor-map#101, released as `@sjvair/monitor-map@3.3.0`.
- [x] **Data dashboard scaffold** — Vite/Svelte app, tab-routing skeleton (Monitors/HMS/
      Collocation Sites, all placeholders), preferences store + URL-state codec
      utilities (unit-tested), and this set of project docs.
      Plan: `docs/superpowers/plans/2026-09-14-data-dashboard-scaffold.md`

## Next up

- [ ] **Monitors tab** — real content: entry_type filter, date range selector, client-side
      county filter, and map/chart/spreadsheet views wired to `@sjvair/sdk` and
      `@sjvair/monitor-map`'s `MapShell`. Needs its own brainstorm/spec/plan cycle
      before implementation (the existing v1 design spec covers requirements at a
      high level; the tab's own data-fetching/state-manager design still needs to be
      worked out in detail).
- [ ] **HMS Smoke/Fire tab**
- [ ] **Collocation Sites tab**

## Open questions / decisions to revisit

- Whether a spreadsheet view of raw HMS smoke/fire records is worth building for v1,
  or should stay map-only (noted as an open decision in the design spec).
- Exact home for the shared date-range helper currently only in `monitor-map`'s
  `data-chart/DateRange.ts` — extract to `@sjvair/sdk`'s `datetime` module, or a
  `monitor-map` export both projects consume? Decide when building the first tab that
  needs it.
- Visual/brand design (colors, typography beyond the inherited shadcn defaults,
  overall layout polish) is untouched so far — explicitly deferred per the original
  brief ("All initial design ideas are up for debate").
```

- [ ] **Step 5: Commit**

```bash
cd /home/alex/workspace/sjvair/data-dashboard
git add CLAUDE.md ARCHITECTURE.md ROADMAP.md TODO.md
git commit -m "Add project documentation: CLAUDE.md, ARCHITECTURE.md, ROADMAP.md, TODO.md"
```
