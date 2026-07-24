import { spawn, spawnSync } from "node:child_process";

const DEFAULT_MAX_BUFFER = 32 * 1024 * 1024;

function postgresChildEnvironment() {
  const allowedNames = new Set([
    "COMSPEC",
    "HOME",
    "LANG",
    "LC_ALL",
    "PATH",
    "PATHEXT",
    "Path",
    "SystemRoot",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "WINDIR",
    "POSTGRES_CONTAINER_ID",
    "PSQL_BIN",
    "PG_DUMP_BIN",
  ]);
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        allowedNames.has(name) ||
        name.startsWith("PG") ||
        name.startsWith("DOCKER_")
    )
  );
}

function requireSafeDatabaseName(database) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(database)) {
    throw new Error(
      `Unsafe PostgreSQL database name: ${JSON.stringify(database)}`
    );
  }
  return database;
}

function postgresCommand(tool, database, extraArgs = []) {
  const containerId = process.env.POSTGRES_CONTAINER_ID?.trim();
  const safeDatabase = database ? requireSafeDatabaseName(database) : undefined;

  if (containerId) {
    return {
      command: "docker",
      args: [
        "exec",
        "-i",
        containerId,
        tool,
        "--username",
        process.env.PGUSER || "postgres",
        ...(safeDatabase ? ["--dbname", safeDatabase] : []),
        ...extraArgs,
      ],
      env: postgresChildEnvironment(),
    };
  }

  const command =
    tool === "psql"
      ? process.env.PSQL_BIN || "psql"
      : process.env.PG_DUMP_BIN || tool;
  const env = postgresChildEnvironment();
  if (safeDatabase) env.PGDATABASE = safeDatabase;
  return { command, args: extraArgs, env };
}

function commandFailure(label, result) {
  const detail = [result.stdout, result.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();
  const error = new Error(`${label} failed${detail ? `:\n${detail}` : ""}`);
  error.stdout = result.stdout || "";
  error.stderr = result.stderr || "";
  error.status = result.status;
  return error;
}

export function runSql({
  database,
  sql,
  label = "PostgreSQL command",
  capture = true,
  tuplesOnly = false,
}) {
  const extraArgs = [
    "--no-psqlrc",
    "--set=ON_ERROR_STOP=1",
    "--set=VERBOSITY=verbose",
    ...(tuplesOnly ? ["--tuples-only", "--no-align"] : []),
  ];
  const invocation = postgresCommand("psql", database, extraArgs);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: process.cwd(),
    env: invocation.env,
    input: sql,
    encoding: "utf8",
    maxBuffer: DEFAULT_MAX_BUFFER,
    stdio: capture ? "pipe" : ["pipe", "inherit", "inherit"],
  });

  if (result.error) throw result.error;
  if (result.status !== 0) throw commandFailure(label, result);
  return { stdout: result.stdout || "", stderr: result.stderr || "" };
}

export function runSqlExpectingFailure({ database, sql, label, match }) {
  try {
    runSql({ database, sql, label, capture: true });
  } catch (error) {
    const detail = `${error.stdout || ""}\n${error.stderr || ""}`;
    if (match && !match.test(detail)) {
      throw new Error(
        `${label} failed for an unexpected reason:\n${detail.trim()}`,
        { cause: error }
      );
    }
    return detail;
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

export function runSqlAsync({
  database,
  sql,
  label = "Concurrent PostgreSQL command",
}) {
  const invocation = postgresCommand("psql", database, [
    "--no-psqlrc",
    "--set=ON_ERROR_STOP=1",
    "--set=VERBOSITY=verbose",
    "--tuples-only",
    "--no-align",
  ]);

  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: process.cwd(),
      env: invocation.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      stdout += chunk;
    });
    child.stderr.on("data", chunk => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", status => {
      if (status !== 0) {
        reject(commandFailure(label, { status, stdout, stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
    child.stdin.end(sql);
  });
}

export function dumpSchema(database, { noAcl = false, schema } = {}) {
  const invocation = postgresCommand("pg_dump", database, [
    "--schema-only",
    "--no-owner",
    "--no-comments",
    ...(noAcl ? ["--no-acl"] : []),
    ...(schema ? [`--schema=${schema}`] : []),
  ]);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: process.cwd(),
    env: invocation.env,
    encoding: "utf8",
    maxBuffer: DEFAULT_MAX_BUFFER,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw commandFailure(`Schema dump for ${database}`, {
      ...result,
      stdout: "",
    });
  return result.stdout;
}

export function normalizeSchemaDump(dump) {
  return dump
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter(
      line => !line.startsWith("--") && !/^\\(?:un)?restrict\b/.test(line)
    )
    .join("\n")
    .trim();
}

export { postgresChildEnvironment, requireSafeDatabaseName };
