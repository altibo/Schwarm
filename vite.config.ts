import { defineConfig } from "vite";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
export default defineConfig({
  base: "./",
  build: {
    sourcemap: false,
    rollupOptions: {
      // render.html is a dev-only page for the offline render tool and is not deployed.
      input: { main: resolve("index.html"), test: resolve("test.html"), guest: resolve("guest.html") },
    },
  },
  plugins: [
    {
      name: "schwarm-offline-shell",
      apply: "build",
      closeBundle() {
        const bank = JSON.parse(readFileSync("src/audio/sample-bank.json", "utf8"));
        const samples: string[] = [
          ...Object.values(bank.drums as Record<string, { file: string }>).map((d) => d.file),
          ...Object.values(bank.instruments as Record<string, { zones: { file: string }[] }>).flatMap((i) => i.zones.map((z) => z.file)),
        ];
        const assets = readdirSync("dist/assets").map((f) => `assets/${f}`);
        const shell = ["./", "index.html", "test.html", "guest.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "samples/CREDITS.txt", ...assets, ...samples];
        const hash = createHash("sha256");
        for (const f of shell.filter((f) => f !== "./")) hash.update(f).update(readFileSync(`dist/${f}`));
        const id = hash.digest("hex").slice(0, 12);
        const sw = readFileSync("dist/sw.js", "utf8")
          .replace('"__SHELL__"', shell.map((f) => JSON.stringify(f === "./" ? f : `./${f}`)).join(", "))
          .replace("__BUILD_ID__", id);
        writeFileSync("dist/sw.js", sw);
        writeFileSync("dist/version.json", JSON.stringify({ build: id }));
      },
    },
  ],
});
