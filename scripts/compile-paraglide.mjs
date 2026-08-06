import { compile } from "@inlang/paraglide-js";

import { paraglideCompileOptions } from "./paraglide-options.ts";

await compile({
  project: "./project.inlang",
  outdir: "./src/paraglide",
  emitTsDeclarations: true,
  emitGitIgnore: false,
  ...paraglideCompileOptions,
});
