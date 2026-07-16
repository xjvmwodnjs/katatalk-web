import "dotenv/config";
import { runKatagoPersistentBenchmarkCliMain } from "../server/worker/analysisEngines/katagoPersistentBenchmark.ts";

void runKatagoPersistentBenchmarkCliMain(process.argv.slice(2));
