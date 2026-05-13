import "dotenv/config";
import { runKatagoSmokeCliMain } from "../server/worker/analysisEngines/katagoSmokeRun.ts";

void runKatagoSmokeCliMain(process.argv.slice(2));
