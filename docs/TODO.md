# KataTalk — 이후 작업 TODO

> 베타에서는 결제 UI가 **Lemon Squeezy** 만 사용합니다( **일회성 크레딧 팩 구매** , 구독 모델 아님). **Toss** 는 **향후 국내 결제 옵션**으로 검토하며(`tossProvider` 스켈레톤) **현재 checkout UI 에는 노출하지 않습니다**. Paddle 은 **추후 fallback 후보**로만 문서에 남기며 코드는 추가하지 않습니다.

## 결제·법무

- [ ] **Toss** 실결제창·결제 승인 API·웹훅 서명 검증 완성 (`tossProvider.ts` TODO)
- [ ] **Lemon Squeezy** 운영 주문·웹훅 payload 와 `custom_data` 필드 최종 검증 (Checkout URL·redirect_url 연동됨)
- [ ] **환불 정책·이용약관** 법무 검토
- [ ] 운영 웹훅 엔드포인트 URL·시크릿 로테이션 절차

## 인프라

- [ ] **초기 베타 호스팅:** long-running **Node**(Railway 우선, Render 차순) — README 배포 절 참고. **Vercel 은 현재 미사용·보류**(Express listen·raw body webhook·in-process mock·memory rate limit·향후 KataGo worker 등으로 serverless adapter 분리 후 재검토).
- [ ] Supabase **`002` 마이그레이션** 적용 후 `add_credits_from_payment` RPC 검증
- [ ] 기존 `stripe_*` 로 적재된 `credit_logs` 가 있다면 조회·리포트만 legacy 로 유지
- [ ] **Lemon `order_created`**: redacted JSON fixture 추가 후 `lemonsqueezyProvider` idempotency 키 우선순위 고정 테스트

## 분석

- [x] **`analysis_jobs` Supabase 저장** — 상태·결과는 DB 행 기준 (`GET` 조회도 DB만 사용).
- [x] **mock 분석 worker 분리(스켈레톤)** — `claim_next_analysis_job` RPC + `pnpm worker:analysis` / `ANALYSIS_WORKER_MODE`. **004 마이그레이션** 적용 필요.
- [ ] **KataGo / LLM** (현재 mock만).
- [ ] **KataGo worker** — `worker:analysis` 자리에 실 엔진 연결·리소스·타임아웃 설계.

## 운영 배포 체크리스트

- [ ] Supabase 마이그레이션 **001 / 002 / 003 / 004** 적용
- [ ] Clerk production 도메인·Redirect URL
- [ ] Lemon Squeezy live API key·store·webhook signing secret
- [ ] Lemon live variant ID 3종
- [ ] `APP_BASE_URL` production 공개 HTTPS URL
- [ ] Variant 가격·크레딧: Starter $4.99 / 20 · Standard $9.99 / 50 · Pro $29.99 / 200
- [ ] 결제 후 credits 증가 수동 테스트·`credit_logs` 확인
- [ ] Rate limit 429 동작 확인 (멀티 인스턴스 시 Redis/Upstash 등 검토)
- [ ] Production 에서 mock 분석 비활성(`KATATALK_ALLOW_MOCK_ANALYSIS`) 확인
- [ ] KataGo·LLM 미구현 상태 UI/문서 표시
- [ ] 환불 정책·약관 법무 검토
