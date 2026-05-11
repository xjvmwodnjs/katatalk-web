# KataTalk — 이후 작업 TODO

> 크레딧·결제·Supabase 스키마/RPC 기본 구현은 반영되었습니다. 아래는 **운영 완성도·법무·실분석** 쪽 남은 작업입니다.

## 인프라·데이터

- [ ] Supabase SQL 마이그레이션 적용 후 **RLS·RPC** 동작 검증(스테이징)
- [ ] 기존 MySQL `user_wallets` / `credit_ledger` 데이터가 있다면 **Supabase `profiles` / `credit_logs`로 이전** 전략 수립(현재 레거시 코드: `server/creditDb.legacy.ts`)

## 결제·법무

- [ ] **환불 정책·이용약관** 문구 법무 검토 (UI 체크박스 문구는 TODO 표기됨)
- [ ] Stripe **라이브** 키·Webhook·Price ID 전환 체크리스트

## 분석 파이프라인

- [ ] **in-memory mock job** 대신 **DB/큐 기반 워커**로 전환 (Vercel/serverless 운영 필수)
- [ ] **KataGo** 워커 연결 및 실분석 결과 저장
- [ ] **LLM** 해설(선택) 파이프라인
