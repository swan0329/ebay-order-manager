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
- `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_LOCATION_ID`, `SHOPIFY_API_VERSION`: 자체 스토어용 Shopify 서버 통합과 재고 위치. 서버는 Client Credentials 토큰을 발급해 만료 전까지 캐시한다. 기존 Admin Custom App은 `SHOPIFY_ADMIN_ACCESS_TOKEN`을 대신 사용할 수 있다. 주문 수집에는 `read_orders` 권한이 필요하고, 60일 이전 주문까지 수집하려면 승인된 `read_all_orders` 권한도 필요하다.
- `POCAMARKET_BRIDGE_TOKEN`: 서버와 로컬 Android 연결 사이의 전용 공유 토큰. 양쪽에 같은 값을 두되 브라우저에는 노출하지 않는다.
- `POCAMARKET_API_BASE`: 로컬 Android 연결이 작업을 가져올 배포 서버 주소.
- `POCAMARKET_BRIDGE_CONFIG`: 로컬 기기의 앱 패키지·화면 좌표 설정 파일 경로. 서버 환경에는 두지 않는다.
- `ADB_PATH`: 로컬 Android Debug Bridge 실행 파일 경로. 서버 환경에는 두지 않는다.
- `LOCAL_AI_WORKER_TOKEN`: 로컬 이미지 작업자 전용 인증값. 작업 서버와 로컬 작업자에만 둔다.
- `OPENAI_API_KEY`, `OPENAI_VISION_MODEL`: 선택적 이미지 분석 제공자와 모델. 해당 분석 기능을 켠 서버에만 둔다.
- `HUGGINGFACE_API_TOKEN`: 선택적 이미지 임베딩 모델 접근값. 공개 모델만 쓸 때는 필요하지 않을 수 있다.
- `DEWATERMARK_API_KEY`, `DEWATERMARK_API_MODE`: 워터마크 제거 API 키와 기본 처리 방식. STANDARD는 장당 1크레딧, PRO는 3크레딧이다.
- `DEWATERMARK_BILLING_URL`: 선택값. AI 이미지 작업 화면의 `크레딧 충전하기` 링크 주소이며 https만 허용한다. 비우면 `https://dewatermark.ai/ko/api-management`를 사용한다.
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

## 리전

Vercel 함수 리전(`vercel.json`의 `regions`)과 Supabase 데이터베이스 리전은 반드시 같은 곳에 둔다. 다른 대륙에 두면 질의 한 번에 1초 이상이 들어 화면 전체가 느려진다. 현재는 데이터베이스가 `ap-southeast-2`(시드니)이므로 함수도 `syd1`이다. 데이터베이스를 옮기면 함수 리전도 함께 바꾼다. 확인은 관리자 세션으로 `GET /api/admin/db-latency`를 호출해 `SELECT 1` 왕복 시간을 본다. 같은 리전이면 10ms 안팎, 다른 대륙이면 수백~수천 ms가 나온다.

## 배포

Vercel 배포 전에 운영 환경변수와 PostgreSQL 백업을 확인한다. 스키마 변경이 있으면 배포 대상 커밋의 마이그레이션을 `npm run db:deploy`로 적용한 뒤 애플리케이션을 배포한다. eBay 콜백과 삭제 통지 URL은 실제 HTTPS 도메인과 정확히 일치해야 한다. 배포 뒤 로그인 역할 분리, eBay 연결 상태, R2 읽기, 데이터베이스 상태 확인을 수행하되 실제 구매나 게시를 자동 실행하지 않는다.

로컬 포카마켓·AI 작업자는 배포 서버와 별도로 실행한다. 전용 토큰과 기기 설정을 로컬에 보관하고, 한 번에 하나의 정상 기기만 연결됐는지 확인한 뒤 시작한다.

### 포카마켓 휴대전화 연결

프로젝트 루트 또는 바탕화면의 `포카마켓 휴대폰 연결.cmd`를 실행하면 로컬 브라우저 연결 페이지가 열린다. 저장된 주소와 mDNS 자동 검색을 먼저 시도하고, 연결되지 않았을 때만 화면에서 페어링 정보를 받는다. 처음 연결할 때는 휴대전화의 `설정 > 개발자 옵션 > 무선 디버깅 > 페어링 코드로 기기 페어링`에 표시되는 페어링 주소와 6자리 코드를 페이지에 입력한다. 그다음 페어링 창을 닫고 무선 디버깅 메인 화면에 표시되는 별도의 연결 주소를 입력한다. 성공한 연결 주소는 로컬 `pocamarket-bridge.config.json`에 저장한다. 로컬 서버는 `127.0.0.1`에만 열리고 상태 변경 요청은 같은 로컬 페이지에서 온 요청만 허용한다.

페어링 포트와 연결 포트는 서로 다르며 무선 디버깅을 껐다 켜면 달라질 수 있다. 휴대전화와 PC는 같은 Wi-Fi에 있어야 한다. 연결 뒤 도우미 창을 열어 둔 상태에서 관리 화면의 `폰으로 구매`를 누른다. 결제 비밀번호와 생체 인증은 자동 입력하지 않는다. 콘솔에서 동일한 도우미를 실행하려면 `npm run pocamarket:connect`를 사용한다.

### Vercel 비용 한도로 인한 중단

배포가 Ready여도 프로젝트가 paused이면 운영 URL은 DEPLOYMENT_PAUSED(503)를 반환한다. Vercel 프로젝트 이벤트의 reasonCode가 BUDGET_REACHED인지 확인하고 Billing의 Spend Amount, 추가 사용료, Pause Production Deployments 설정을 대조한다. 한도를 넘긴 상태에서 재개만 반복하면 다시 중단된다. 비용 한도를 임의로 해제하지 말고 사용자가 승인한 금액을 설정한 뒤 프로젝트를 재개하고 운영 상태와 작업 진행을 검증한다.


무선 디버깅을 다시 켠 경우 주문의 `휴대폰 연결·다시 연결`을 누른다. 로컬 도우미가 꺼져 있으면 `포카마켓-휴대폰-연결.cmd`를 먼저 실행한다. 저장 주소와 자동 검색으로 연결한 뒤 기존 대기 요청을 이어간다. 한 장을 휴대폰에서 결제한 후 주문 화면의 `휴대폰 결제 1장 완료`를 눌러 다음 장을 진행한다. 결제 확인 대기·진행 중인 작업이 있으면 다른 요청을 시작하지 않는다. 실패 또는 중단된 진행 작업은 실제 결제 여부를 확인하기 전 자동 재구매하지 않는다.
