import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildProductReviewWorkbenchV1,
  redactWorkbenchTextV1,
  renderProductReviewWorkbenchMarkdownV1,
} from "../shared/productReviewWorkbenchV1";

type OutputFormat = "markdown" | "json";

function printUsage(): void {
  console.error("Usage: tsx scripts/localAlgorithmWorkbenchV1.ts <completed-result.json> [--format markdown|json] [--out report.md]");
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactWorkbenchTextV1(message);
}

function parseArgs(argv: string[]): { inputPath: string; outPath: string | null; format: OutputFormat } | null {
  const inputPath = argv[0];
  if (inputPath == null || inputPath.startsWith("--")) {
    return null;
  }
  let outPath: string | null = null;
  let format: OutputFormat = "markdown";
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--format") {
      const next = argv[i + 1];
      if (next !== "markdown" && next !== "json") return null;
      format = next;
      i += 1;
      continue;
    }
    if (arg === "--out") {
      const next = argv[i + 1];
      if (next == null || next.startsWith("--")) return null;
      outPath = next;
      i += 1;
      continue;
    }
    return null;
  }
  return { inputPath, outPath, format };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args == null) {
    printUsage();
    process.exitCode = 2;
    return;
  }

  try {
    const raw = await readFile(resolve(args.inputPath), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const report = buildProductReviewWorkbenchV1(parsed);
    const output =
      args.format === "json"
        ? `${redactWorkbenchTextV1(JSON.stringify(report, null, 2))}\n`
        : renderProductReviewWorkbenchMarkdownV1(report);

    if (args.outPath != null) {
      await writeFile(resolve(args.outPath), output, "utf8");
    } else {
      process.stdout.write(output);
    }
  } catch (error) {
    console.error(`Local Algorithm Workbench failed: ${safeErrorMessage(error)}`);
    process.exitCode = 1;
  }
}

void main();
