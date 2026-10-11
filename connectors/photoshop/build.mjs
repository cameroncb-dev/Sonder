// Bundles the panel for UXP. `photoshop` and `uxp` are provided by the host.
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const options = {
  entryPoints: ["src/panel.ts"],
  outfile: "plugin/dist/panel.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  external: ["photoshop", "uxp"],
  sourcemap: "inline",
  logLevel: "info",
};

if (watch) {
  await (await esbuild.context(options)).watch();
} else {
  await esbuild.build(options);
}
