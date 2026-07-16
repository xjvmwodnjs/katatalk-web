import "dotenv/config";
import { runKatagoProductSmokeCliMain } from "../server/katagoProductSmoke.ts";

void runKatagoProductSmokeCliMain(process.argv.slice(2));
