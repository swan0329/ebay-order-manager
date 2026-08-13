# 운영 절차

## 개발 환경 준비

필수 조건은 Node.js, npm, PostgreSQL, 프로젝트에서 사용하는 외부 서비스 계정이다.

```powershell
npm install
Copy-Item .env.example .env
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

`.env`에 실제 값을 넣기 전에는 서버가 정상 동작하지 않는다. 데이터베이스 변경 전에 클라이언트를 생성하고 마이그레이션을 적용하며, 초기 관리자 계정은 seed 또는 `npm run admin:password` 절차로 준비한다.

## 필수 환경 설정

- `DATABASE_URL`: PostgreSQL 연결 문자열. 운영에서는 연결 풀링 방식과 직접 연결 방식의 용도를 혼동하지 않는다.
- `SESSION_SECRET`: 로그인 쿠키 서명용 장기 무작위 값.
- `TOKEN_ENCRYPTION_KEY`: 저장된 외부 토큰 암호화용 32바이트 키.
- `ADMIN_LOGIN_ID`, `ADMIN_PASSWORD`: 초기 관리자 생성·재설정에만 사용하며 기본값을 운영에 사용하지 않는다.
- `EBAY_ENV`, `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_RU_NAME`, `EBAY_SCOPES`: eBay 환경과 OAuth 설정.
- `EBAY_DELETION_VERIFICATION_TOKEN`, `EBAY_DELETION_ENDPOINT_URL`: eBay 계정 삭제 통지 검증.
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_BASE_URL`: 상품 이미지 저장.
- `CLOUDFLARE_R2_PUBLIC_URL`, `CLOUDFLARE_R2_PUBLIC_BASE_URL`: 기존 R2 공개 주소 호환값. 새 배포에서는 `R2_PUBLIC_BASE_URL`을 우선한다.
- `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_LOCATION_ID`, `SHOPIFY_API_VERSION`: Shopify 앱과 재고 위치. Shopify 등록을 사용할 서버에만 둔다.
- `POCAMARKET_BRIDGE_TOKEN`: 서버와 로컬 Android 연결 사이의 전용 공유 토큰. 양쪽에 같은 값을 두되 브라우저에는 노출하지 않는다.
- `POCAMARKET_API_BASE`: 로컬 Android 연결이 작업을 가져올 배포 서버 주소.
- `POCAMARKET_BRIDGE_CONFIG`: 로컬 기기의 앱 패키지·화면 좌표 설정 파일 경로. 서버 환경에는 두지 않는다.
- `ADB_PATH`: 로컬 Android Debug Bridge 실행 파일 경로. 서버 환경에는 두지 않는다.
- `LOCAL_AI_WORKER_TOKEN`: 로컬 이미지 작업자 전용 인증값. 작업 서버와 로컬 작업자에만 둔다.
- `OPENAI_API_KEY`, `OPENAI_VISION_MODEL`: 선택적 이미지 분석 제공자와 모델. 해당 분석 기능을 켠 서버에만 둔다.
- `HUGGINGFACE_API_TOKEN`: 선택적 이미지 임베딩 모델 접근값. 공개 모델만 쓸 때는 필요하지 않을 수 있다.
- `CRON_SECRET`: 예약 상태 확인 요청의 Bearer 인증값.
- `CF_ACCOUNT_ID`, `CF_API_TOKEN`: Cloudflare 관리 API를 사용하는 운영 작업 전용 값. 일반 R2 읽기·쓰기 자격증명과 혼용하지 않는다.
- `EBAY_MARKETPLACE_ID`: 기본 eBay 마켓. 상품별 값이 없을 때 적용한다.

코드가 직접 읽는 운영 변수는 `.env.example`보다 많다. 새 변수를 추가하거나 이름을 바꿀 때 이 목록과 `.env.example`을 같은 변경에서 갱신한다.

## 검증

```powershell
npm test
npm run lint
npm run build
```

세 명령이 모두 성공해야 배포 가능 상태다. 외부 서비스 변경은 sandbox 또는 쓰기 없는 연결 확인을 먼저 수행하고, 실제 상품 게시·구매·배송 처리는 별도 사람 확인으로 검증한다.

## 배포

Vercel 배포 전에 운영 환경변수와 PostgreSQL 백업을 확인한다. 스키마 변경이 있으면 배포 대상 커밋의 마이그레이션을 `npm run db:deploy`로 적용한 뒤 애플리케이션을 배포한다. eBay 콜백과 삭제 통지 URL은 실제 HTTPS 도메인과 정확히 일치해야 한다. 배포 뒤 로그인 역할 분리, eBay 연결 상태, R2 읽기, 데이터베이스 상태 확인을 수행하되 실제 구매나 게시를 자동 실행하지 않는다.

로컬 포카마켓·AI 작업자는 배포 서버와 별도로 실행한다. 전용 토큰과 기기 설정을 로컬에 보관하고, 한 번에 하나의 정상 기기만 연결됐는지 확인한 뒤 시작한다.
