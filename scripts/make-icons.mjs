// Generates the PWA icons in static-src/icons/ (regular and maskable, 192 and 512).
//
// Re-run with:  node scripts/make-icons.mjs   (from the repo root; commit the PNG output)
//
// Regular icons come from the SJVAir app icon in the sibling mobile repo
// (../mobile/src/assets/icons/icon-512.webp). Maskable icons place the round logo mark
// (src/lib/assets/logos/sjvair-parts/sjvair-icon.webp) inside the central 80% safe zone on solid white.
import sharp from "sharp";

const APP_ICON = new URL("../../mobile/src/assets/icons/icon-512.webp", import.meta.url);
const MARK = new URL("../src/lib/assets/logos/sjvair-parts/sjvair-icon.webp", import.meta.url);
const OUT = new URL("../static-src/icons/", import.meta.url);

for (const size of [192, 512]) {
	await sharp(APP_ICON.pathname)
		.resize(size, size)
		.png()
		.toFile(new URL(`icon-${size}.png`, OUT).pathname);

	const inner = Math.round(size * 0.8);
	const mark = await sharp(MARK.pathname).resize(inner, inner, { fit: "contain" }).png().toBuffer();
	await sharp({
		create: { width: size, height: size, channels: 4, background: "#ffffff" }
	})
		.composite([{ input: mark, gravity: "centre" }])
		.png()
		.toFile(new URL(`maskable-${size}.png`, OUT).pathname);
}
