import "dotenv/config";
import { runKatagoProductSmokeSuiteCliMain } from "../server/katagoProductSmokeSuite.ts";

void runKatagoProductSmokeSuiteCliMain(process.argv.slice(2));
