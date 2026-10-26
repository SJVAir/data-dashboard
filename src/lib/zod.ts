import { z } from "zod";

// Zod probes for `new Function` when it builds its first object schema, to pick a faster parser.
// Under the workspace CSP (no 'unsafe-eval') that probe is reported as a violation on every load,
// so turn the compiled parser off. Every module imports `z` from here, never from "zod", so this
// runs before any schema is built (ESLint enforces it).
z.config({ jitless: true });

export { z };
