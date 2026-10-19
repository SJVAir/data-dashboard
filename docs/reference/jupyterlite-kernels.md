# In-browser notebook kernels: evaluation

Snapshot of web research done 2026-09-23 for IDEA.md Open Question #6, to decide which
kernels to bundle in an embedded JupyterLite. Re-verify versions before acting on it.

**Outcome:** embed JupyterLite with **Python (Pyodide) only**. R and JavaScript in the
browser are deferred (see `DEFERRED.md`). R, JavaScript, and TypeScript users are served
by **Export to notebook** bundles that run in local Jupyter/RStudio/Deno instead. See
`ARCHITECTURE.md` → "Notebooks".

## Licensing

JupyterLite and JupyterLab use BSD-3-Clause. Pyodide uses MPL-2.0 (file-level copyleft,
which has no effect when it's used unmodified). The bundled scientific packages (numpy,
pandas, scipy, statsmodels, matplotlib) use BSD or similar permissive licenses. Nothing
blocks embedding it; we only need to ship the license notices.

## Python: Pyodide via `jupyterlite-pyodide-kernel` (chosen)

- **State:** Pyodide 314.0.7 (2026-09-14) runs real **CPython 3.14.2** and is very actively
  maintained. Kernel 0.8.6 (2026-09-10) pins one exact Pyodide version, so **upgrade the
  two together**.
- **Offline:** the whole thing can be bundled.
  - `jupyter lite build --pyodide <local tarball>` bundles Pyodide itself.
  - `--pyodide-lock` builds a custom lockfile containing only the stack we need.
  - `--piplite-wheels` adds pure-Python wheels.
  - `"disablePyPIFallback": true` blocks runtime PyPI calls.
  - Size is roughly 60–150 MB for a trimmed scientific stack (estimate). Packages load
    lazily per import.
- **Packages:**
  - Built into Pyodide: pandas 3, numpy 2.4, scipy, statsmodels, scikit-learn,
    matplotlib, pyarrow (Parquet), polars, duckdb, requests, pyodide-http.
  - Not built in: seaborn and plotly. Both are pure Python, so bundle them as piplite
    wheels. plotly also needs its JupyterLab renderer extension.
  - Smoke-test pyarrow: the changelog shows it was dropped and then re-added.
- **Limits users will notice:**
  - Threads, multiprocessing, and subprocess don't work, and sklearn's `n_jobs` falls back
    to a single core.
  - wasm32 caps memory at 2–4 GB.
  - There are no raw sockets. HTTP goes through the browser and is subject to CORS.
  - Packages that aren't bundled can't be installed while offline.
  - Some stdlib modules are removed (curses, termios, tkinter, …).
  - Pure-Python code runs roughly 1.5–3× slower (estimate).
- **Cross-origin isolation:** optional. With COOP/COEP, the kernel uses SharedArrayBuffer
  for file access and `input()`. Without it, it falls back to a service worker. **If
  neither is available, the kernel can't see the file browser's files.**

## R: xeus-r (rejected for now)

- xeus-r 0.11.2 (2026-07) runs **R 4.5.3**. Only about 166 R packages exist on
  emscripten-forge.
- **Available:** dplyr, tidyr, readr, lubridate, ggplot2, data.table, arrow 23, mgcv, lme4.
- **Missing:** `sf`, `openair`, CRAN `install.packages()` (libcurl is patched out and
  nothing can compile packages in the browser), and all networking. The tidyverse
  metapackage likely won't install because of curl/httr/ragg.
- **webR alternative:** Posit's R-in-wasm has about 22,700 packages, including sf,
  openair, and tidyverse, but not arrow. Its JupyterLite kernel is stale (no push since
  2025-06), has no cell interrupt, and **requires** COOP/COEP.
- **Verdict:** R users would feel limited to a subset. Revisit if `openair` and `sf`
  reach emscripten-forge, or if the webR JupyterLite kernel is revived.

## JavaScript: xeus-javascript vs `jupyterlite/javascript-kernel` (both rejected for now)

- **xeus-javascript 0.4.2** (2025-11) is stale: one maintainer, no commits in about 10
  months. At startup it **loads its code parser from jsDelivr**, so it can't start offline
  without a patch.
- **`jupyterlite/javascript-kernel`** is maintained by the JupyterLite core team (commits
  as of 2026-09-22). It starts offline and has an IFrame mode with a real DOM (so uPlot
  would work), plus widgets. Its 0.4 line is still **alpha**.
- Both run browser JavaScript, not Node: no npm, no `fs`, no TypeScript, and imports only
  by URL.
- **For local use instead:** Deno's built-in Jupyter kernel (`deno jupyter`) supports real
  TypeScript and npm/JSR imports, including `@sjvair/sdk` from JSR.

## Tauri caveat (applies to every kernel)

Service workers don't register on Tauri's custom `tauri://` scheme on macOS
(wry#389). Under Tauri, the kernels therefore need cross-origin isolation, set through
Tauri 2's `app.security.headers` (applied in production builds only), to see their files.
None of this has been verified on WKWebView or WebKitGTK, so it belongs in the Tauri
spike.
