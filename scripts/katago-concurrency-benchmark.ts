import "dotenv/config";
import { runKatagoConcurrencyBenchmarkCliMain } from "../server/katagoConcurrencyBenchmark.ts";

void runKatagoConcurrencyBenchmarkCliMain(process.argv.slice(2));
