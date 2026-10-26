import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

const ICONS = [
	{ name: "icon-192.png", sizes: "192x192" },
	{ name: "icon-512.png", sizes: "512x512" }
];
const ICON_DIR = new URL("../static-src/icons/", import.meta.url);

function srgb(linear: number): number {
	const c = Math.min(1, Math.max(0, linear));
	return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

/** Converts `oklch(L C H)` (as written in `src/app.css`) to `#rrggbb`. */
export function oklchToHex(value: string): string {
	const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value.trim());
	if (!match) throw new Error(`Expected an oklch(L C H) color, got: ${value}`);
	const [l, c, h] = [Number(match[1]), Number(match[2]), (Number(match[3]) * Math.PI) / 180];
	const a = c * Math.cos(h);
	const b = c * Math.sin(h);
	const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const rgb = [
		4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
		-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
		-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_
	];
	return `#${rgb
		.map((v) =>
			Math.round(srgb(v) * 255)
				.toString(16)
				.padStart(2, "0")
		)
		.join("")}`;
}

export function buildManifest(opts: {
	name: string;
	shortName: string;
	themeColor: string;
	backgroundColor: string;
	icons: Array<{ src: string; sizes: string }>;
}): object {
	return {
		name: opts.name,
		short_name: opts.shortName,
		start_url: "/workspace/",
		scope: "/workspace/",
		display: "standalone",
		theme_color: opts.themeColor,
		background_color: opts.backgroundColor,
		icons: opts.icons.map((icon) => ({ ...icon, type: "image/png" }))
	};
}

function lightToken(css: string, token: string): string {
	const match = new RegExp(`${token}:\\s*(oklch\\([^)]*\\))`).exec(css);
	if (!match) throw new Error(`${token} not found in src/app.css`);
	return oklchToHex(match[1]);
}

function manifestFor(icons: Array<{ src: string; sizes: string }>): object {
	const css = readFileSync(new URL("../src/app.css", import.meta.url), "utf8");
	const messages = JSON.parse(
		readFileSync(new URL("../messages/en.json", import.meta.url), "utf8")
	) as { app_name: string };
	return buildManifest({
		name: messages.app_name,
		shortName: messages.app_name,
		themeColor: lightToken(css, "--primary"),
		backgroundColor: lightToken(css, "--background"),
		icons
	});
}

/**
 * Emits `workspace/manifest.webmanifest` and its icons (as hashed assets under `workspace/assets/`),
 * with icon `src` values relative to the manifest. `vite dev` serves the same manifest from a
 * middleware; `vite preview` serves the built file.
 */
export function webManifest(): Plugin {
	return {
		name: "sjvair-web-manifest",
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const path = (req.url ?? "").split("?")[0];
				if (path === "/workspace/manifest.webmanifest") {
					res.setHeader("Content-Type", "application/manifest+json");
					res.end(
						JSON.stringify(
							manifestFor(ICONS.map((i) => ({ src: `icons/${i.name}`, sizes: i.sizes })))
						)
					);
					return;
				}
				const icon = ICONS.find((i) => path === `/workspace/icons/${i.name}`);
				if (icon) {
					res.setHeader("Content-Type", "image/png");
					res.end(readFileSync(new URL(icon.name, ICON_DIR)));
					return;
				}
				next();
			});
		},
		generateBundle() {
			const icons = ICONS.map((icon) => {
				const id = this.emitFile({
					type: "asset",
					name: icon.name,
					source: readFileSync(new URL(icon.name, ICON_DIR))
				});
				return { src: this.getFileName(id).replace(/^workspace\//, ""), sizes: icon.sizes };
			});
			this.emitFile({
				type: "asset",
				fileName: "workspace/manifest.webmanifest",
				source: JSON.stringify(manifestFor(icons))
			});
		}
	};
}
