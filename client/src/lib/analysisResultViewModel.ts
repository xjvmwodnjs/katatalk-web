/** Re-export — UI는 `@shared/analysisResultViewModel` 단일 구현을 사용 */
export {
  buildAnalysisResultViewModel,
  type AnalysisResultViewModel,
  type BuildAnalysisResultViewModelOpts,
  type KatagoWorkerV1AnalysisViewModel,
  type MockLegacyAnalysisViewModel,
  type UnknownAnalysisViewModel,
  type AnalysisResultWinratePointV1,
  type AnalysisResultKeyMoveCandidateV1,
  type AnalysisResultVariationPreviewV1,
  type AnalysisResultVmWarningV1,
  type AnalysisResultVmWarningCodeV1,
  SGF_PLACEHOLDER_NO_SOURCE,
  SGF_PLACEHOLDER_MOCK_SCOPE,
  SGF_PLACEHOLDER_UNKNOWN,
} from "@shared/analysisResultViewModel";
export type {
  SgfPlaybackViewModelV1,
  SgfPlaybackActiveV1,
  SgfPlaybackPlaceholderV1,
  SgfPlaybackStoneV1,
  SgfPlaybackLastMoveV1,
  SgfPlaybackWarningV1,
  SgfPlaybackWarningCodeV1,
  ExtractMainlineBwMovesResultV1,
} from "@shared/sgfPlaybackV1";