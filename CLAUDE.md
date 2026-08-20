# eBay 포토카드 판매 관리

내부 관리자와 이미지 작업자가 포토카드 상품, 재고, 주문, 이미지, eBay·Shopify 등록을 관리하는 단일 조직용 웹 애플리케이션이다. 포카마켓은 부족 재고의 조달처이자 시세 기준이며, 판매·구매·이미지 결과의 최종 결정은 사람이 내린다.

## 프로젝트 안내

```text
프로젝트 루트/
├── CLAUDE.md                         → Claude Code 작업 진입점
├── AGENTS.md                         → Codex 작업 진입점(이 파일과 동일)
├── docs/
│   ├── architecture.md               → 시스템 구성과 데이터 흐름
│   ├── business-rules.md             → 재고·가격·구매·이미지 업무 규칙
│   ├── security.md                   → 사용자 권한과 민감정보 정책
│   ├── standards.md                  → 변경 시 반드시 지킬 개발 규칙
│   ├── engineering-notes.md          → 반복해서 문제를 일으키는 기술적 함정
│   ├── operations.md                 → 설치·검증·배포 절차
│   ├── contracts.md                  → 외부 시스템과 내부 API의 약속
│   └── tracking/
│       ├── status.md                 → 구현 완료·미완료 현황
│       ├── handoff.md                → 남은 작업과 지켜야 할 선, 확인된 사실
│       ├── findings.md               → 아직 해결되지 않은 문제
│       └── decisions/
│           ├── index.md              → 주요 선택 목록
│           ├── 0001-human-confirmation.md
│           ├── 0002-pocamarket-data-collection.md
│           ├── 0003-margin-based-price.md
│           ├── 0004-access-revocation.md
│           └── 0005-feature-branches.md
├── src/app/AGENTS.md                 → 화면과 요청 처리 경계
├── src/lib/AGENTS.md                 → 업무 로직과 외부 서비스 연결 경계
├── prisma/AGENTS.md                  → 데이터 구조와 변경 규칙
└── scripts/AGENTS.md                 → 로컬 작업자·관리 스크립트 규칙
```

## 절대 지켜야 할 사항

- 주문·가격·재고·판매 계정 변경은 관리자만 수행하며, 작업자는 배정된 이미지 작업만 수행한다.
- 재고 차감과 복구는 이력과 주문 항목의 처리 표시를 함께 남겨야 하며 같은 주문을 두 번 차감하면 안 된다.
- 포카마켓 구매, 이미지 채택, 계산된 판매가의 eBay 반영에는 사람의 명시적인 확인이 필요하다.
- 이 프로젝트의 Next.js는 설치된 버전의 동작을 기준으로 한다. 변경 전에 `node_modules/next/dist/docs/`의 해당 문서를 읽고 폐기 예정 API를 사용하지 않는다.

## 작업 전 확인

- 모든 변경 전에 `docs/standards.md`, `docs/engineering-notes.md`, 변경할 디렉터리의 `AGENTS.md`를 읽는다.
- 남은 작업을 이어받을 때는 `docs/tracking/handoff.md`를 먼저 읽는다. 이미 확인한 사실을 다시 조사하지 않기 위해서다.
- 로그인·권한을 바꾸기 전에는 `docs/security.md`와 `src/lib/session.ts`의 페이지·API 권한 검사를 함께 확인한다.
- 재고·주문을 바꾸기 전에는 `docs/business-rules.md`와 재고 이력 생성 경로를 확인한다.
- 데이터 구조를 바꾸기 전에는 `prisma/AGENTS.md`와 기존 마이그레이션을 확인한다. 요청 시 테이블을 만드는 임시 코드가 남아 있는 영역도 함께 조사한다.
- 포카마켓·eBay·Shopify·R2 연결을 바꾸기 전에는 `docs/contracts.md`와 실패·재시도·중복 처리 방식을 확인한다.

권한 우회, 중복 재고 차감, 운영 비밀 노출, 구매자 정보 외부 공개, 되돌릴 수 없는 데이터 손상 가능성을 발견하면 즉시 사용자에게 알린다. 그 밖의 현재 작업에서 해결할 수 없는 문제는 재현 조건과 영향을 `docs/tracking/findings.md`에 기록한다.
