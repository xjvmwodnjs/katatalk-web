import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildMigrationScript,
  defaultMigrationDirectory,
  loadMigrationManifest,
} from "../scripts/db/migrationRunner.mjs";

const temporaryDirectories: string[] = [];

function temporaryMigrationDirectory(files: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), "katatalk-migrations-"));
  temporaryDirectories.push(directory);
  for (const [name, source] of Object.entries(files)) {
    writeFileSync(join(directory, name), source);
  }
  return directory;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe("Supabase migration runner", () => {
  it("loads the repository manifest in a contiguous numeric order", () => {
    const manifest = loadMigrationManifest({
      directory: defaultMigrationDirectory,
    });

    expect(manifest.map((entry: { version: number }) => entry.version)).toEqual(
      Array.from({ length: manifest.length }, (_, index) => index + 1)
    );
    expect(manifest.at(-1).filename).toBe(
      "013_harden_security_definer_functions.sql"
    );
    expect(
      manifest.every((entry: { checksum: string }) =>
        /^[0-9a-f]{64}$/.test(entry.checksum)
      )
    ).toBe(true);
  });

  it("rejects gaps and non-canonical filenames", () => {
    const gap = temporaryMigrationDirectory({
      "001_first.sql": "SELECT 1;\n",
      "003_third.sql": "SELECT 3;\n",
    });
    expect(() => loadMigrationManifest({ directory: gap })).toThrow(
      /expected 002, found 003/
    );

    const invalid = temporaryMigrationDirectory({ "1_bad.sql": "SELECT 1;\n" });
    expect(() => loadMigrationManifest({ directory: invalid })).toThrow(
      /Invalid migration filename/
    );

    const valid = temporaryMigrationDirectory({
      "001_first.sql": "SELECT 1;\n",
    });
    expect(() =>
      loadMigrationManifest({ directory: valid, through: "1junk" })
    ).toThrow(/Invalid migration target/);
  });

  it("builds one locked transaction with checksum guards and history writes", () => {
    const directory = temporaryMigrationDirectory({
      "001_first.sql": "SELECT 'first';\n",
      "002_second.sql": "SELECT 'second';\n",
    });
    const manifest = loadMigrationManifest({ directory, through: 2 });
    const script = buildMigrationScript(manifest);

    expect(script).toContain("BEGIN;");
    expect(script).toContain("pg_advisory_xact_lock");
    expect(script).toContain("katatalk_schema_migrations");
    expect(script).toContain("pg_catalog.aclexplode");
    expect(script).toContain(
      "REVOKE ALL ON TABLE public.katatalk_schema_migrations FROM %I"
    );
    expect(script).toContain("migration 001 filename or checksum mismatch");
    expect(script).toContain("SELECT 'first';");
    expect(script).toContain("SELECT 'second';");
    expect(script.trimEnd()).toMatch(/COMMIT;$/);
  });

  it("rejects missing and malformed CLI option values before invoking psql", () => {
    const cli = resolve(process.cwd(), "scripts", "db", "migrate.mjs");
    const missing = spawnSync(process.execPath, [cli, "--through"], {
      encoding: "utf8",
    });
    const malformed = spawnSync(
      process.execPath,
      [cli, "--through=1junk", "--database=katatalk_test"],
      { encoding: "utf8" }
    );

    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("--through requires a value");
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toContain("Invalid migration target");
  });
});
