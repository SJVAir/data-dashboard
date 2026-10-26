import "./app.css";

// The build entry (`app.js`). Mounts into the host page's element; the page doesn't pass a path,
// so files are found relative to this module.
const target = document.getElementById("SJVAirDataDashboard")!;
const staticBase = new URL(".", /* @vite-ignore */ import.meta.url);

void import("./main").then((m) => m.startApp({ target, staticBase }));
