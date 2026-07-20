#!/usr/bin/env node
import { applyMigrations } from "./migrationRunner.mjs";

function parseArguments(argv) {
  const options = {};
  const takeValue = (argument, index) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value`);
    }
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--through") {
      options.through = takeValue(argument, index);
      index += 1;
    } else if (argument.startsWith("--through=")) {
      options.through = argument.slice("--through=".length);
    } else if (argument === "--database") {
      options.database = takeValue(argument, index);
      index += 1;
    } else if (argument.startsWith("--database=")) {
      options.database = argument.slice("--database=".length);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.through === "" || options.database === "") {
    throw new Error("Migration arguments cannot be empty");
  }
  if (!options.database && process.env.POSTGRES_CONTAINER_ID) {
    throw new Error("--database is required when POSTGRES_CONTAINER_ID is set");
  }
  const result = applyMigrations(options);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  console.log(`Applied or verified ${result.manifest.length} migration(s).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
