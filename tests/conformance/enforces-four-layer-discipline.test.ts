import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * Enforces the four-layer discipline as a build gate.
 *
 * The discipline is not a style preference: a capability body that reacquires
 * decisionality, or a kernel that learns a provider's name, fails here.
 *
 * The rules are declared in authority/code-body.conformance.v1.json. This file
 * executes them.
 */

const REPOSITORY_ROOT = new URL("../../", import.meta.url);

type CodeCategory = Readonly<{
  categoryId: string;
  directory?: string;
  directories?: readonly string[];
  mayContainControlFlow: boolean;
  forbiddenSyntax?: readonly string[];
  forbiddenTokens?: readonly string[];
  forbiddenDomainLiterals?: Readonly<{ tokens: readonly string[] }>;
}>;

const conformance = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("authority/code-body.conformance.v1.json", REPOSITORY_ROOT)),
    "utf8"
  )
) as { categories: readonly CodeCategory[] };

function readsSourceFiles(directory: string): readonly (readonly [string, string])[] {
  const absolute = fileURLToPath(new URL(directory, REPOSITORY_ROOT));

  return readdirSync(absolute)
    .filter((entry) => entry.endsWith(".ts"))
    .map(
      (entry) =>
        [
          `${directory}${entry}`,
          readFileSync(fileURLToPath(new URL(`${directory}${entry}`, REPOSITORY_ROOT)), "utf8"),
        ] as const
    );
}

function readsCategoryFiles(
  category: CodeCategory
): readonly (readonly [string, string])[] {
  const directories = category.directories ?? [category.directory as string];

  return directories.flatMap(readsSourceFiles);
}

/** Strips comments and string literals so prose never trips a syntax check. */
function readsExecutableSource(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

/** Collects every string literal, where a provider field reference would hide. */
function readsStringLiterals(source: string): readonly string[] {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

  return [...withoutComments.matchAll(/"([^"\n]*)"|'([^'\n]*)'/g)].map(
    (match) => match[1] ?? match[2] ?? ""
  );
}

const SYNTAX_PATTERNS: Readonly<Record<string, RegExp>> = {
  IfStatement: /\bif\s*\(/,
  SwitchStatement: /\bswitch\s*\(/,
  ForStatement: /\bfor\s*\([^)]*;/,
  ForOfStatement: /\bfor\s*\(\s*(?:const|let|var)\b[^)]*\bof\b/,
  ForInStatement: /\bfor\s*\(\s*(?:const|let|var)\b[^)]*\bin\b/,
  WhileStatement: /\bwhile\s*\(/,
  DoWhileStatement: /\bdo\s*\{/,
};

describe("Four-layer discipline: capability bodies contain no authored control flow", () => {
  const bodies = conformance.categories.filter(
    (category) => !category.mayContainControlFlow
  );

  it("declares at least one capability-body category", () => {
    assert.ok(bodies.length >= 1);
  });

  for (const category of bodies) {
    for (const [path, source] of readsCategoryFiles(category)) {
      it(`${path} contains no forbidden statement syntax`, () => {
        const executable = readsExecutableSource(source);

        for (const syntax of category.forbiddenSyntax ?? []) {
          const pattern = SYNTAX_PATTERNS[syntax];

          assert.ok(
            pattern !== undefined && !pattern.test(executable),
            `${path} contains a ${syntax}. Capability bodies invoke resolved authority; they do not author control flow.`
          );
        }
      });
    }
  }
});

describe("Four-layer discipline: no layer reacquires provider knowledge", () => {
  for (const category of conformance.categories) {
    for (const [path, source] of readsCategoryFiles(category)) {
      it(`${path} names no provider or provider field`, () => {
        const literals = readsStringLiterals(source);

        for (const token of category.forbiddenTokens ?? []) {
          assert.ok(
            !literals.some((literal) => literal.includes(token)),
            `${path} references "${token}". That knowledge belongs in an authority document.`
          );
        }
      });
    }
  }
});

describe("Four-layer discipline: capability bodies name no canonical disposition", () => {
  const bodies = conformance.categories.filter(
    (category) => category.forbiddenDomainLiterals !== undefined
  );

  for (const category of bodies) {
    for (const [path, source] of readsCategoryFiles(category)) {
      it(`${path} decides no disposition of its own`, () => {
        const withoutComments = source
          .replace(/\/\*[\s\S]*?\*\//g, " ")
          .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

        for (const token of category.forbiddenDomainLiterals?.tokens ?? []) {
          assert.ok(
            !withoutComments.includes(token),
            `${path} names the disposition ${token}. Dispositions come from decision tables.`
          );
        }
      });
    }
  }
});

describe("Four-layer discipline: the kernel is domain-free", () => {
  it("contains no reference to the response normalizer's own vocabulary", () => {
    for (const [path, source] of readsSourceFiles("src/kernel/")) {
      const literals = readsStringLiterals(source);

      for (const token of ["normaliz", "canonical-model-response", "provider-dialect"]) {
        assert.ok(
          !literals.some((literal) => literal.toLowerCase().includes(token)),
          `${path} references "${token}". The kernel must be reusable by any capability.`
        );
      }
    }
  });

  it("imports nothing from a capability body", () => {
    for (const [path, source] of readsSourceFiles("src/kernel/")) {
      assert.ok(
        !/from "\.\.\/(normalize-provider-response|project-provider-response)\//.test(source),
        `${path} imports from a capability body. The kernel may not depend on the capability it serves.`
      );
    }
  });
});
