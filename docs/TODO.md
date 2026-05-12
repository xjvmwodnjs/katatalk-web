# KataTalk — 이후 작업 TODO

> 베타에서는 결제 UI가 **Lemon Squeezy** 만 사용합니다. **Toss** 는 **향후 국내 결제 옵션**으로 검토하며(`tossProvider` 스켈레톤). Paddle 은 **추후 fallback 후보**로만 문서에 남기며 코드는 추가하지 않습니다.

## 결제·법무

- [ ] **Toss** 실결제창·결제 승인 API·웹훅 서명 검증 완성 (`tossProvider.ts` TODO)
- [ ] **Lemon Squeezy** 운영 주문·웹훅 payload 와 `custom_data` 필드 최종 검증 (Checkout URL·redirect_url 연동됨)
- [ ] **환불 정책·이용약관** 법무 검토
- [ ] 운영 웹훅 엔드포인트 URL·시크릿 로테이션 절차

## 인프라

- [ ] Supabase **`002` 마이그레이션** 적용 후 `add_credits_from_payment` RPC 검증
- [ ] 기존 `stripe_*` 로 적재된 `credit_logs` 가 있다면 조회·리포트만 legacy 로 유지

## 분석

- [x] **`analysis_jobs` Supabase 저장** — 상태·결과는 DB 행 기준 (`GET` 조회도 DB만 사용). mock 파이프라인은 동일 테이블만 갱신.
- [ ] **운영 배포 전**: DB-backed **queue/worker** 전환 (Vercel/serverless 에서 in-process mock 타이머 비권장).
- [ ] **KataGo / LLM** (현재 mock 유지).
- [ ] **KataGo worker·큐** 설계 및 연동.
