import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
const nativeRequire = createRequire(import.meta.url);

// Exercise the actual TypeScript modules with isolated database and network mocks.
export function loadModule(relativePath, mocks = {}, cache = new Map()) {
  const filename = resolve(root, relativePath);
  if (cache.has(filename)) return cache.get(filename);
  const loadedModule = { exports: {} };
  cache.set(filename, loadedModule.exports);
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
  });
  const requireModule = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    if (specifier.startsWith("@/")) return loadModule(`${specifier.slice(2)}.ts`, mocks, cache);
    if (specifier.startsWith(".")) {
      return loadModule(resolve(dirname(filename), specifier.endsWith(".ts") ? specifier : `${specifier}.ts`), mocks, cache);
    }
    return nativeRequire(specifier);
  };
  runInThisContext(`(function(require, module, exports) {\n${outputText}\n})`, { filename })(
    requireModule, loadedModule, loadedModule.exports
  );
  return loadedModule.exports;
}
