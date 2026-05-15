# Winrate axis sample verification (KataGo)

> **Scope:** documentation and sample checklist only.
> **Not in scope:** `blackWinrate` / `whiteWinrate` conversion, `status: verified` in code, B/W toggle UI.

## 1. Purpose

Confirm which **perspective** KataGo `winrate` values use before mapping them to black/white display winrates or enabling a B/W toggle.

Today the product chart uses **`moveSummary.played.winrate`** (a row from `moveInfos` matching the played move at `turnIndex`), normalized as **KataGo output** (`katago_output_only`). We do **not** yet assert that this equals black winrate, white winrate, or “side to move” winrate.

## 2. KataGo fields to inspect

| Field | Where | Role in pipeline |
|--------|--------|------------------|
| `rootInfo.winrate` | KataGo analysis JSON | Position evaluation before the candidate move list; stored in `turnAnalyses[].katago.rootInfo` |
| `rootInfo.currentPlayer` | same | KataGo’s reported side to move at the analyzed position |
| `moveInfos[].winrate` | same | Per-candidate move stats; **chart uses the row whose `move` equals `playedMove`** |
| `query.moves` | Built query (not always stored in result) | SGF mainline moves **before** `turnIndex` (see `sliceMovesBeforeTurnIndex`) |
| `query.movesBeforeCount` | `turnAnalyses[].query` | `turnIndex - 1` — number of moves on the board when KataGo analyzes |
| `turnIndex` | `turnAnalyses[]` | **1-based** mainline move number (the move being reviewed) |
| `player` | `turnAnalyses[]` | Color that **played** move `turnIndex` (`B` or `W`) |

**Current UI path:** `buildWinrateSeries` → `moveSummary.played.winrate` → `normalizeWinratePerspectiveV1` → `displayWinrate` (0–100, KataGo label).

**Evidence fields today:** `evidence.turnIndex`, `evidence.player`, `evidence.currentPlayer`, `evidence.playerToMove` — populated from ViewModel; `currentPlayer` / `playerToMove` are currently aligned with `player` until axis is verified (see §5).

## 3. Sample types to collect

Collect **real** KataGo stdout/JSON (or exported `turnAnalyses` slices) per scenario. Minimum set:

| # | Scenario | What to record |
|---|----------|----------------|
| S1 | Black clearly ahead | High winrate when black should be favored |
| S2 | White clearly ahead | High winrate when white should be favored |
| S3 | Early balanced | ~50% region, few moves |
| S4 | Side to move = Black | `rootInfo.currentPlayer === "B"` (or KataGo equivalent) |
| S5 | Side to move = White | `rootInfo.currentPlayer === "W"` |

For each sample, save: engine version, rules, komi, board size, `turnIndex`, `player`, full `rootInfo`, top 3 `moveInfos`, and `moveSummary.played` / `moveSummary.best`.

**Shape-only (not axis truth):** `server/fixtures/winrateAxisSamplesV1.ts` — JSON shape + normalizer guards only. `shapeOnly: true` samples **do not** satisfy verified promotion; use real KataGo exports for S1–S5 below.

## 4. Questions to answer per sample

For each sample, fill a short table:

1. **Black perspective?** If we assume winrate = P(Black wins), does S1 show high and S2 show low?
2. **`currentPlayer` perspective?** Does winrate track the player in `rootInfo.currentPlayer`?
3. **Side-to-move (query) perspective?** Does winrate track the player about to move at `movesBeforeCount` (i.e. opposite of last move on board, or equal to `currentPlayer`)?
4. **`moveInfos` same axis?** Do `rootInfo.winrate`, `moveInfos[0].winrate`, and `moveSummary.played.winrate` use the **same** convention (allowing small search noise)?
5. **Played vs root:** Is `played.winrate` closer to root or to best candidate? Document delta.

**Hypothesis to falsify:** “`played.winrate` is always black winrate.”
**Hypothesis to falsify:** “`played.winrate` is always winrate for `player` (move color).”

## 5. Field semantics (project conventions)

| Term | Meaning |
|------|---------|
| `turnIndex` | 1-based index into SGF **mainline**; the reviewed move is `moves[turnIndex - 1]` |
| `movesBeforeCount` | Moves on board **before** that move is played (`turnIndex - 1`) |
| `player` | Who **played** the move at `turnIndex` (from SGF color) |
| `playedMove` / GTP | Coordinate of that move |
| `currentPlayer` (KataGo `rootInfo`) | Side to move at analyzed position (verify against KataGo docs + samples) |
| `playerToMove` (evidence) | Intended: side to move at query position; **until verified, do not use for conversion** |
| `currentPlayer` (evidence in UI) | Placeholder aligned with pipeline; **until verified, chart label stays “KataGo output”** |

## 6. `verified` promotion conditions (concrete)

All must be true before implementing conversion or toggle. **Synthetic `shapeOnly` fixtures never count** toward these gates.

1. **Checklist coverage:** Real KataGo samples for **all types S1–S5** (black favored, white favored, early balanced, side-to-move black, side-to-move white).
2. **Volume:** **≥ 3 independent games** (or ≥ 3 distinct games with multiple turns each) showing **consistent** axis interpretation across samples.
3. **rootInfo vs moveInfos:** Same axis for `rootInfo.winrate` and `moveInfos[].winrate` on every real sample (document max allowed drift).
4. **Played row:** `moveSummary.played.winrate` follows the same axis as `rootInfo` (chart dependency).
5. **Player linkage:** Documented rule tying winrate to `currentPlayer`, `player`, or black — with counterexamples ruled out; `movesBeforeCount = turnIndex - 1` confirmed on real exports.
6. **Engine metadata:** KataGo version, rules, komi recorded; re-verify on engine upgrade.
7. **UI copy:** ko/en/ja/zh strings approved; no forbidden judgment labels.
8. **Tests:** Fixture-backed tests for conversion (future PR); existing tests keep `blackWinrate`/`whiteWinrate` null until then.
9. **Explicit code path:** Only a dedicated function sets `status: "verified"`; normalizer never auto-promotes.

See also: `WINRATE_VERIFIED_PROMOTION_REQUIREMENTS_V1` in `shared/winratePerspectiveV1.ts`.

## 7. Black / white conversion formula candidates (do not implement yet)

Document only. Pick one after §4–6 are satisfied.

| ID | Formula (raw `w` = verified 0..1 axis) | Notes |
|----|----------------------------------------|--------|
| F1 | If axis = black: `blackWinrate = w`, `whiteWinrate = 1 - w` | Common if KataGo reports black winrate |
| F2 | If axis = white: `whiteWinrate = w`, `blackWinrate = 1 - w` | Mirror of F1 |
| F3 | If axis = side to move `S`: `winrate(S) = w`, `winrate(opponent) = 1 - w` | Needs `playerToMove` at each turn |
| F4 | If axis = mover `player` at `turnIndex`: map using `player` per point | Matches “who just played” interpretation |
| F5 | Keep `displayWinrate` as raw axis × 100; toggle only swaps label | Minimal change; still need axis truth |

**Rejected until verified:** inferring black/white from `turnIndex` parity alone.

## 8. Explicitly deferred

- Computing `blackWinrate` / `whiteWinrate` in production code
- Enabling B/W winrate toggle
- Replacing `displayWinrate` with converted values
- Auto-setting `status: verified`
- Changing Worker/KataGo query or parser behavior in this step

## 9. Recording template

```markdown
### Sample S1 — <game id> turn <n>
- Engine: KataGo <version>, rules <>, komi <>
- turnIndex: , player: , movesBeforeCount:
- rootInfo.winrate: , rootInfo.currentPlayer:
- moveInfos[0].winrate: , played.winrate:
- Conclusion: axis = black | white | currentPlayer | unknown
```
