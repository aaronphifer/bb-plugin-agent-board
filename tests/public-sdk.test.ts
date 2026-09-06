// The public-surface contract test: the plugin must import only public SDK
// entrypoints, Zod, Node builtins, relative package-local files, and the
// explicitly documented shim/vendored surfaces below — never private @bb/*
// workspace packages or paths that escape the package.
import { describe, expect, it } from "vitest";
import { experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const packageRoot = new URL("..", import.meta.url).pathname;

/**
 * Public packages beyond the SDK this plugin may import:
 * - react / react-dom: provided by the BB app at runtime (never bundled).
 * - @/…: the package-local tsconfig path alias (baseUrl is the package root).
 * - radix portal families + clsx/tailwind-merge/class-variance-authority:
 *   UI primitives BB shims at runtime (declared in devDependencies).
 * - @hugeicons/*: the vendored icon set (declared in dependencies, bundled).
 */
const ALLOW = [
  /^react$/u,
  /^react-dom$/u,
  /^@\//u,
  /^@radix-ui\/react-(?:slot|dialog|checkbox)$/u,
  /^clsx$/u,
  /^tailwind-merge$/u,
  /^class-variance-authority$/u,
  /^@hugeicons\/(?:react|core-free-icons)$/u,
  /^vitest\/config$/u,
] as const;

describe("public SDK only", () => {
  it("has no violations and no private dependencies", () => {
    const scan = experimental_scanPublicSdkOnly(packageRoot, { allow: ALLOW });
    expect(scan.violations).toEqual([]);
    expect(scan.privateDependencies).toEqual([]);
  });

  it("scanned the plugin sources", () => {
    const scan = experimental_scanPublicSdkOnly(packageRoot, { allow: ALLOW });
    expect(scan.files.length).toBeGreaterThan(0);
    expect(scan.files.some((file) => file.endsWith("server.ts"))).toBe(true);
    expect(scan.files.some((file) => file.endsWith("app.tsx"))).toBe(true);
    expect(scan.files.some((file) => file.endsWith("lib/bb-source.ts"))).toBe(true);
  });

  it("still catches private packages and escaping paths", () => {
    // Prove the scanner works: a throwaway package with a private @bb/*
    // import and an escaping relative path must be flagged. (The import
    // strings are assembled from pieces so this test file itself stays clean
    // under the scanner's from-import regex.)
    const badRoot = mkdtempSync(join(tmpdir(), "bb-scan-"));
    writeFileSync(join(badRoot, "package.json"), "{}");
    // Assembled from pieces so this test file's own source never matches the
    // scanner's from-import regex.
    const fromWord = ["fr", "om"].join("");
    const privatePkg = ["@bb/", "internal-helpers"].join("");
    const escapePath = ["../../", "outside"].join("");
    writeFileSync(
      join(badRoot, "plugin.ts"),
      `import { helper } ${fromWord} "${privatePkg}";\nexport const x = helper;\n`,
    );
    mkdirSync(join(badRoot, "sub"));
    writeFileSync(
      join(badRoot, "sub", "escape.ts"),
      `import { up } ${fromWord} "${escapePath}";\nexport const y = up;\n`,
    );
    const bad = experimental_scanPublicSdkOnly(badRoot, { allow: ALLOW });
    expect(bad.violations).toContainEqual({
      file: "plugin.ts",
      specifier: privatePkg,
      reason: "private-package",
    });
    expect(bad.violations).toContainEqual({
      file: join("sub", "escape.ts"),
      specifier: escapePath,
      reason: "outside-package",
    });
    rmSync(badRoot, { recursive: true, force: true });
  });
});