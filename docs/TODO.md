# KataTalk — 이후 작업 TODO

> 현재 `master` 반영분은 **Clerk 인증 + Drizzle/MySQL 크레딧 지갑** 까지입니다. **Supabase DB 전환·Stripe 실결제·KataGo** 는 아래에서 단계적으로 진행합니다.

## 인프라·데이터

- [ ] **Supabase** `profiles` / `credit_logs`(또는 동등 스키마)로 마이그레이션 작성 — `profiles.id` ↔ Clerk `userId` 매핑
- [ ] 기존 MySQL `user_wallets` / `credit_ledger` 데이터 이전 전략(더블 라이트 / 단일 컷오버) 결정

## 결제·크레딧

- [ ] Stripe **Checkout `mode=payment`** 기반 **크레딧 팩** 구매 플로우
- [ ] Stripe **webhook**에서만 크레딧 증가 처리(success URL 클라이언트만으로 잔액 변경 금지)
- [ ] Webhook **idempotency**(이벤트·결제 intent 단위 중복 방지)
- [ ] 결제 UI: **환불 정책 동의** 체크박스와 실제 결제 버튼 연동

## 분석 파이프라인

- [ ] **DB 기반 job store** 및 **큐/워커**로 전환(in-memory job 제거)
- [ ] **KataGo** 워커 연결 및 실분석 결과 저장
