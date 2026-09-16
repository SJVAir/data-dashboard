export type Bounds = [number, number, number, number];

export function unionBounds(boundsList: Array<Bounds>): Bounds | null {
	if (boundsList.length === 0) return null;

	let [minX, minY, maxX, maxY] = boundsList[0];

	for (const [x0, y0, x1, y1] of boundsList.slice(1)) {
		minX = Math.min(minX, x0);
		minY = Math.min(minY, y0);
		maxX = Math.max(maxX, x1);
		maxY = Math.max(maxY, y1);
	}

	return [minX, minY, maxX, maxY];
}
