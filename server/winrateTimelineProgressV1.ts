import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  isWinrateTimelineProgressEventV1,
  mergeWinrateTimelineProgressEventsV1,
  type WinrateTimelineProgressEventV1,
  type WinrateTimelineProgressResponseV1,
} from "@shared/winrateTimelineV1";

const DEFAULT_PROGRESS_DIR = path.join(".tmp", "katatalk-progress");

function safeJobId(jobId: string): string | null {
  const t = jobId.trim();
  return /^[A-Za-z0-9_-]{6,128}$/.test(t) ? t : null;
}

export function winrateTimelineProgressPathForJobV1(
  jobId: string,
  cwd = process.cwd()
): string | null {
  const safe = safeJobId(jobId);
  if (!safe) {
    return null;
  }
  return path.resolve(cwd, DEFAULT_PROGRESS_DIR, `${safe}.jsonl`);
}

function redactedEvent(
  event: WinrateTimelineProgressEventV1
): WinrateTimelineProgressEventV1 {
  return {
    jobId: event.jobId,
    turnIndex: event.turnIndex,
    isDuringSearch: event.isDuringSearch,
    visits: event.visits,
    winrate: event.winrate,
    scoreLead: event.scoreLead,
    currentPlayer: event.currentPlayer,
    ...(event.winratePerspective
      ? { winratePerspective: event.winratePerspective }
      : {}),
    receivedAt: event.receivedAt,
  };
}

export async function appendWinrateTimelineProgressEventV1(
  event: WinrateTimelineProgressEventV1,
  cwd = process.cwd()
): Promise<void> {
  const filePath = winrateTimelineProgressPathForJobV1(event.jobId, cwd);
  if (!filePath || !isWinrateTimelineProgressEventV1(event)) {
    return;
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(redactedEvent(event))}\n`, {
    encoding: "utf8",
    flag: "a",
  });
}

export async function readWinrateTimelineProgressV1(
  jobId: string,
  cwd = process.cwd()
): Promise<WinrateTimelineProgressResponseV1 | null> {
  const filePath = winrateTimelineProgressPathForJobV1(jobId, cwd);
  if (!filePath) {
    return null;
  }
  let raw = "";
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return null;
  }
  const events: WinrateTimelineProgressEventV1[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) {
      continue;
    }
    try {
      const parsed = JSON.parse(t) as unknown;
      if (isWinrateTimelineProgressEventV1(parsed) && parsed.jobId === jobId) {
        events.push(parsed);
      }
    } catch {
      /* ignore malformed local progress line */
    }
  }
  const points = mergeWinrateTimelineProgressEventsV1(events);
  const completedCount = points.filter(p => !p.isDuringSearch).length;
  const partialCount = points.filter(p => p.isDuringSearch).length;
  const maxTurn = points.reduce((m, p) => Math.max(m, p.turnIndex), -1);
  return {
    success: true,
    jobId,
    enabled: true,
    events,
    points,
    completedCount,
    partialCount,
    totalPoints: maxTurn >= 0 ? maxTurn + 1 : null,
  };
}
