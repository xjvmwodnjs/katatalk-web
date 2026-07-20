# Database migration gate

## 목적

Supabase PostgreSQL 스키마는 번호가 매겨진 migration을 **`001` → `002` → … → `013` 숫자순**으로만 적용한다. 이미 이력이 있는 DB를 추측으로 baseline 처리하지 않는다. reviewed baseline이 없으면 gate는 fail-closed 한다.

## 실행 명령

- `pnpm db:migrate:supabase`: `PG*` 환경변수로 지정한 PostgreSQL 또는 CI container에 migration을 적용한다. 이력 없는 기존 DB는 검토·승인된 baseline manifest가 없으면 거부한다.
- `pnpm test:db:migrations`: fresh/upgrade, checksum, 권한·원자성·동시성 검증을 실행하고 `.tmp/database-gate`에 schema/ACL 및 security snapshot artifact를 남긴다. 이 명령은 DB와 cluster role을 재생성하므로 `POSTGRES_CONTAINER_ID`와 `KATATALK_DB_GATE_CONFIRM=ephemeral-postgres`가 지정된 **폐기 가능한 PostgreSQL container에서만** 실행된다.

## 기존 DB 도입 경계

`katatalk_schema_migrations` 이력 없이 `profiles`, `credit_logs`, `analysis_jobs` 중 하나라도 있는 DB는 runner가 즉시 거절한다. 기존 Supabase 프로젝트를 자동으로 baseline하지 않는다. 실제 schema/ACL fingerprint와 적용 이력을 검토한 승인 artifact 및 잠긴 baseline 절차는 아직 별도 출시 게이트이며, 준비되기 전에는 기존 운영 DB에 이 runner를 사용하지 않는다.

## 013 보안 고정

`013_harden_security_definer_functions.sql`은 11개 `SECURITY DEFINER` 함수의 owner, `search_path=pg_catalog`, 함수 ACL과 관련 table ACL을 고정한다. `PUBLIC`, `anon`, `authenticated`의 실행은 거부되어야 하며 실제 `anon`·`authenticated` 호출은 PostgreSQL `42501`을 반환해야 한다.

## CI 시나리오

1. **Fresh**: 빈 DB에 `001 → 013` 적용.
2. **Upgrade**: `011`까지 적용된 DB에 `012 → 013` 적용.
3. migration filename/checksum drift는 실패.
4. 실제 권한으로 `anon`·`authenticated`의 `42501` 거부를 확인.
5. rollback/fault-injection, quarantine recovery, concurrent replay 및 terminal race를 확인.
6. fresh와 upgrade의 schema 및 ACL equivalence를 비교하고 SQL dump, migration manifest, checksum, RPC security snapshot을 artifact로 보존.

이 gate가 통과하기 전에는 production migration을 승인하지 않는다.
