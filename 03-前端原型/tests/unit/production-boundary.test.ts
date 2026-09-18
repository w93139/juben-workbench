import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

const src = fileURLToPath(new URL("../../src/", import.meta.url));
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
function localImport(from: string, specifier: string) {
  if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return null;
  const base = specifier.startsWith("@/") ? resolve(src, specifier.slice(2)) : resolve(dirname(from), specifier);
  return [base, ...[".ts", ".tsx", ".json", "/index.ts", "/index.tsx"].map(ext => base + ext)].find(path => /\.(tsx?|json)$/.test(path) && existsSync(path)) ?? null;
}
function runtimeImports(file: string) {
  if (file.endsWith(".json")) return [];
  const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const imports: string[] = [];
  function visit(node: ts.Node) {
    let specifier: ts.Expression | undefined;
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (clause?.isTypeOnly) return;
      const named = clause?.namedBindings;
      if (!clause?.name && named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every(e => e.isTypeOnly)) return;
      specifier = node.moduleSpecifier;
    } else if (ts.isExportDeclaration(node)) {
      if (node.isTypeOnly) return;
      if (node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.every(e => e.isTypeOnly)) return;
      specifier = node.moduleSpecifier;
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")) {
      specifier = node.arguments[0];
    }
    if (specifier && ts.isStringLiteral(specifier)) {
      const path = localImport(file, specifier.text);
      if (path) imports.push(path);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return imports;
}

it("所有App入口与服务端路由均不加载历史模拟流程", () => {
  const pending = files(resolve(src, "app")).filter(file => /\/(page|layout|route|not-found|error|loading)\.tsx?$/.test(file));
  expect(pending.length).toBeGreaterThan(10);
  const seen = new Set<string>();
  while (pending.length) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file); pending.push(...runtimeImports(file));
  }
  const paths = [...seen].map(file => relative(src, file));
  expect(paths).toContain("services/local-project-service.ts");
  expect(paths).toContain("services/zip.ts");
  expect(paths.filter(path => /services\/(mock-project-service|mock-source-import|export-service|(?:research|blueprint|folder-plan|production)-operations)\.ts$/.test(path))).toEqual([]);
  // Read-only sample metadata is intentional; simulated workflow fixtures are not.
  expect(paths.filter(path => path.startsWith("mocks/") && path !== "mocks/names-beyond.json")).toEqual([]);
});
