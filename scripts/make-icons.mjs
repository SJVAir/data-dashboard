// Generates the PWA icons in static-src/icons/ (regular and maskable, 192 and 512).
//
// Re-run with:  node scripts/make-icons.mjs   (from the repo root; commit the PNG output)
//
// `sharp` is available transitively via @sveltejs/enhanced-img.
//
// Regular icons come from the SJVAir app icon in the sibling mobile repo
// (../mobile/src/assets/icons/icon-512.webp). Maskable icons place the round logo mark
// (src/lib/assets/logos/sjvair-parts/sjvair-icon.webp) inside the central 80% safe zone on solid white.
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const APP_ICON = new URL("../../mobile/src/assets/icons/icon-512.webp", import.meta.url);
const MARK = new URL("../src/lib/assets/logos/sjvair-parts/sjvair-icon.webp", import.meta.url);
const OUT = new URL("../static-src/icons/", import.meta.url);

for (const size of [192, 512]) {
	await sharp(fileURLToPath(APP_ICON))
		.resize(size, size)
		.png()
		.toFile(fileURLToPath(new URL(`icon-${size}.png`, OUT)));

	const inner = Math.round(size * 0.8);
	const mark = await sharp(fileURLToPath(MARK))
		.resize(inner, inner, { fit: "contain" })
		.png()
		.toBuffer();
	await sharp({
		create: { width: size, height: size, channels: 4, background: "#ffffff" }
	})
		.composite([{ input: mark, gravity: "centre" }])
		.png()
		.toFile(fileURLToPath(new URL(`maskable-${size}.png`, OUT)));
}
