import path from "node:path";
import { CLIENT_BUILD_MANIFEST_FILE } from "../../scripts/clientBuildArtifactCore";

type HeaderWriter = {
  setHeader(name: string, value: string): unknown;
};

export function applyClientBuildManifestHeaders(
  response: HeaderWriter,
  filePath: string
): boolean {
  if (path.basename(filePath) !== CLIENT_BUILD_MANIFEST_FILE) {
    return false;
  }
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
  return true;
}
