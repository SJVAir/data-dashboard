import type { FileAccess, OpenedFile } from "../types";

/** Saving downloads a file; opening shows the browser's file picker. */
export function createWebFiles(doc: Document = document): FileAccess {
	return {
		save(name, contents, type) {
			const url = URL.createObjectURL(new Blob([contents], { type }));
			const a = doc.createElement("a");
			a.href = url;
			a.download = name;
			a.hidden = true;
			doc.body.appendChild(a);
			a.click();
			a.remove();
			// Revoke later so the download has started.
			setTimeout(() => URL.revokeObjectURL(url), 1000);
		},
		open(accept) {
			return new Promise<OpenedFile | null>((resolve) => {
				const input = doc.createElement("input");
				input.type = "file";
				input.accept = accept;
				input.hidden = true;
				const done = (file: File | undefined) => {
					input.remove();
					resolve(file ? { name: file.name, size: file.size, text: () => file.text() } : null);
				};
				input.addEventListener("change", () => done(input.files?.[0]), { once: true });
				input.addEventListener("cancel", () => done(undefined), { once: true });
				doc.body.appendChild(input);
				input.click();
			});
		}
	};
}
