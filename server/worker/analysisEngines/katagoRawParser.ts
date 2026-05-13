export type KatagoRawFormat = "json" | "jsonl" | "unknown";

export type KatagoSmokeDocument = {
  ok: boolean;
  source: "katago-smoke";
  input: {
    sgfSha256: string;
    sgfSizeBytes: number;
  };
  katago: {
    rawFormat: KatagoRawFormat;
    rootInfo: Record<string, unknown>;
    moveInfosCount: number;
    topMove: unknown | null;
    exitCode: number | null;
    commandPreview: string;
  };
  normalized: {
    hasWinrate: boolean;
    hasScoreLead: boolean;
    hasOwnership: boolean;
    sampleMoveInfos: unknown[];
  };
  error?: string;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/** 줄 단위 또는 단일 JSON 객체에서 파싱 가능한 객체 목록 추출 */
export function extractJsonObjectsFromKatagoStdout(raw: string): unknown[] {
  const t = raw.trim();
  if (!t) {
    return [];
  }
  try {
    const one = JSON.parse(t) as unknown;
    return [one];
  } catch {
    /* fall through line-wise */
  }
  const out: unknown[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) {
      continue;
    }
    try {
      out.push(JSON.parse(s) as unknown);
    } catch {
      /* skip non-json line */
    }
  }
  return out;
}

export function detectKatagoStdoutFormat(raw: string, objects: unknown[]): KatagoRawFormat {
  if (objects.length === 0) {
    return "unknown";
  }
  if (objects.length >= 2) {
    return "jsonl";
  }
  const t = raw.trim();
  const lines = t.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length <= 1) {
    return "json";
  }
  return "jsonl";
}

/** rootInfo / moveInfos 가 있는 객체를 우선, 없으면 마지막 plain object */
export function pickPrimaryAnalysisObject(objects: unknown[]): Record<string, unknown> | null {
  const objs = objects.filter(isPlainObject);
  if (objs.length === 0) {
    return null;
  }
  const withSignals = objs.filter((o) => "rootInfo" in o || "moveInfos" in o);
  const pool = withSignals.length > 0 ? withSignals : objs;
  return pool[pool.length - 1] ?? null;
}

function rootHasWinrate(rootInfo: Record<string, unknown>): boolean {
  return typeof rootInfo.winrate === "number";
}

function rootHasScoreLead(rootInfo: Record<string, unknown>): boolean {
  return typeof rootInfo.scoreLead === "number";
}

function rootHasOwnership(rootInfo: Record<string, unknown>): boolean {
  return Array.isArray(rootInfo.ownership);
}

function moveInfosHaveWinrate(moveInfos: unknown[]): boolean {
  return moveInfos.some((m) => isPlainObject(m) && typeof m.winrate === "number");
}

export function buildKatagoSmokeNormalized(params: {
  sgfSha256: string;
  sgfSizeBytes: number;
  rawStdout: string;
  exitCode: number | null;
  commandPreview: string;
}): KatagoSmokeDocument {
  const objects = extractJsonObjectsFromKatagoStdout(params.rawStdout);
  const rawFormat = detectKatagoStdoutFormat(params.rawStdout, objects);
  const primary = pickPrimaryAnalysisObject(objects);

  const base = (): KatagoSmokeDocument => ({
    ok: false,
    source: "katago-smoke",
    input: { sgfSha256: params.sgfSha256, sgfSizeBytes: params.sgfSizeBytes },
    katago: {
      rawFormat,
      rootInfo: {},
      moveInfosCount: 0,
      topMove: null,
      exitCode: params.exitCode,
      commandPreview: params.commandPreview,
    },
    normalized: {
      hasWinrate: false,
      hasScoreLead: false,
      hasOwnership: false,
      sampleMoveInfos: [],
    },
  });

  if (!primary) {
    const b = base();
    return {
      ...b,
      error:
        rawFormat === "unknown"
          ? "KataGo stdout 이 비어 있거나 JSON/JSONL 로 파싱할 수 없습니다. `katago analysis --help` 로 출력 형식을 확인하세요."
          : "JSON 은 파싱되었으나 rootInfo/moveInfos 가 있는 분석 객체를 찾지 못했습니다.",
    };
  }

  const rootRaw = primary.rootInfo;
  const rootInfo = isPlainObject(rootRaw) ? rootRaw : {};
  const moveInfos = Array.isArray(primary.moveInfos) ? (primary.moveInfos as unknown[]) : [];
  const topMove = moveInfos[0] ?? null;

  const hasWinrate = rootHasWinrate(rootInfo) || moveInfosHaveWinrate(moveInfos);
  const hasScoreLead = rootHasScoreLead(rootInfo);
  const hasOwnership = rootHasOwnership(rootInfo);

  const parseOk =
    params.exitCode === 0 && rawFormat !== "unknown" && (Object.keys(rootInfo).length > 0 || moveInfos.length > 0);

  return {
    ok: parseOk,
    source: "katago-smoke",
    input: { sgfSha256: params.sgfSha256, sgfSizeBytes: params.sgfSizeBytes },
    katago: {
      rawFormat,
      rootInfo,
      moveInfosCount: moveInfos.length,
      topMove,
      exitCode: params.exitCode,
      commandPreview: params.commandPreview,
    },
    normalized: {
      hasWinrate,
      hasScoreLead,
      hasOwnership,
      sampleMoveInfos: moveInfos.slice(0, 3),
    },
    ...(!parseOk
      ? {
          error:
            params.exitCode !== 0
              ? `KataGo 프로세스가 비정상 종료했습니다(exit ${String(params.exitCode)}). stderr 로그 파일을 확인하세요.`
              : "stdout 형식이 예상과 다르거나 rootInfo/moveInfos 가 비어 있습니다.",
        }
      : {}),
  };
}
