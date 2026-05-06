# eBay Order Manager

eBay 주문 조회, OAuth 계정 연결, 송장 등록, 배송 처리 이력 관리를 위한 Next.js MVP입니다. 첫 버전은 ShipStation처럼 단순한 주문/배송 처리 흐름에 집중합니다.

## 주요 기능

- 관리자 로그인 및 세션 쿠키 인증
- eBay OAuth Authorization Code Grant 계정 연결
- eBay Sell Fulfillment API 주문 동기화
- 주문 목록, 주문 상세, 모바일 배송 처리 화면
- 단건 및 일괄 송장 등록
- 배송 처리 결과와 동기화 로그 저장
- 주문 CSV 다운로드
- 내부 상품 DB 등록, 수정, 엑셀/CSV 업로드, CSV 다운로드
- 주문 SKU와 상품 자동/수동 매칭
- 재고 입고, 출고, 조정, 주문별 자동 차감 이력 관리

## 기술 스택

- Next.js App Router, React, Tailwind CSS
- Next.js API Routes
- PostgreSQL + Prisma
- bcryptjs, jose, zod
- Vitest

## 로컬 실행

1. 의존성을 설치합니다.

```bash
npm install
```

2. 환경 파일을 만듭니다.

```bash
copy .env.example .env
```

3. `.env` 값을 설정합니다. `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, `ADMIN_LOGIN_ID`, `ADMIN_PASSWORD`는 로컬 `.env`에 생성되어 있습니다. eBay 관련 3개 값은 eBay Developer Console에서 발급받아 입력해야 합니다.

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ebay_order_manager?schema=public"
SESSION_SECRET="32자 이상 랜덤 문자열"
TOKEN_ENCRYPTION_KEY="32바이트 base64 키"
ADMIN_LOGIN_ID="admin"
ADMIN_PASSWORD="관리자 로그인 비밀번호"
EBAY_ENV="sandbox"
EBAY_CLIENT_ID=""
EBAY_CLIENT_SECRET=""
EBAY_RU_NAME=""
EBAY_DELETION_VERIFICATION_TOKEN=""
EBAY_DELETION_ENDPOINT_URL=""
```

`TOKEN_ENCRYPTION_KEY`는 아래 명령으로 생성할 수 있습니다.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

4. Prisma Client와 DB 테이블을 준비합니다.

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

관리자 로그인 ID 또는 비밀번호를 바꾸려면 아래 명령을 사용합니다. `.env` 수정과 DB 반영을 한 번에 처리합니다.

```bash
npm run admin:password
```

5. 개발 서버를 실행합니다.

```bash
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다.

## eBay OAuth 설정

1. eBay Developer 계정에서 애플리케이션을 생성합니다.
2. RuName을 발급받고 `.env`의 `EBAY_RU_NAME`에 입력합니다.
3. OAuth redirect URL은 아래 주소를 등록합니다.

```text
http://localhost:3000/api/ebay/oauth/callback
```

4. 운영 배포 후에는 Vercel 또는 VPS 도메인의 callback URL도 eBay Developer Console에 추가합니다.
5. 기본 scope는 `sell.fulfillment`와 `commerce.identity.readonly`입니다. 필요한 경우 `EBAY_SCOPES`에 공백 구분으로 추가합니다.

## eBay Production 키 활성화용 삭제 알림 엔드포인트

eBay Production 키 활성화를 위해 Marketplace account deletion notification endpoint를 등록해야 합니다.

앱에는 아래 공개 엔드포인트가 구현되어 있습니다.

```text
/api/ebay/deletion
```

Vercel 배포 후 eBay Developer Console에는 아래 형식의 HTTPS URL을 등록합니다.

```text
https://your-vercel-domain.vercel.app/api/ebay/deletion
```

같은 화면의 Verification token에는 `.env` 또는 Vercel 환경 변수의 `EBAY_DELETION_VERIFICATION_TOKEN`과 동일한 값을 입력합니다. 토큰은 32-80자의 영문/숫자/언더스코어/하이픈만 사용해야 하므로 아래처럼 생성하는 것을 권장합니다.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`EBAY_DELETION_ENDPOINT_URL`은 선택값입니다. 비워두면 요청 URL 기준으로 `https://도메인/api/ebay/deletion`을 계산합니다. eBay에 등록한 URL과 실제 요청 URL이 다를 수 있는 프록시/커스텀 도메인 구성에서는 이 값을 eBay에 등록한 URL과 정확히 동일하게 설정하세요.

eBay가 `GET /api/ebay/deletion?challenge_code=...`로 검증하면 앱은 SHA-256 challenge response를 JSON으로 `200 OK` 응답합니다. 실제 계정 삭제 알림 `POST` 요청도 즉시 `200 OK`로 수신 확인합니다.

## DB 스키마

Prisma schema는 `prisma/schema.prisma`에 있습니다.

- `users`: 관리자 계정
- `ebay_accounts`: eBay OAuth 토큰과 계정 정보
- `orders`: eBay 주문 원본 JSON과 주문 상태
- `order_items`: 주문 line item
- `products`: 내부 상품 DB와 현재 재고
- `inventory_movements`: 입고, 출고, 조정, 주문 차감 이력
- `shipments`: 송장, 배송 처리 상태, eBay fulfillment id
- `sync_logs`: API 동기화 및 오류 로그

토큰은 평문 저장하지 않고 `TOKEN_ENCRYPTION_KEY`로 암호화합니다.

## 주요 화면

- `/login`: 관리자 로그인
- `/connect`: eBay 계정 연결
- `/orders`: 주문 목록, 필터, 동기화, CSV 다운로드
- `/orders/[id]`: 주문 상세, 상품 매칭, 재고 차감, 단건 배송 처리
- `/products`: 상품 DB 목록, 재고 필터, CSV 업로드/다운로드
- `/products/new`: 상품 등록
- `/products/[id]`: 상품 상세, 연결 주문, 재고 이동 이력
- `/inventory`: 입고, 출고, 재고 조정, 이동 이력 CSV 다운로드
- `/shipping`: 선택 주문 일괄 배송 처리
- `/mobile`: 모바일 전용 빠른 송장 입력

## 상품/재고 관리

상품은 SKU를 기준으로 주문 아이템과 매칭합니다. eBay 주문 동기화 또는 주문 상세의 `재고 차감` 실행 시, 주문 아이템의 SKU와 같은 SKU의 상품이 있으면 자동 연결한 뒤 재고를 차감합니다. 이미 차감된 주문 아이템은 `stock_deducted`로 표시되어 중복 차감을 막습니다.

상품은 `/products/new`에서 개별 등록할 수 있고, `/products` 화면의 `엑셀/CSV 업로드`로 대량 등록할 수 있습니다. CSV 헤더는 `sku`, `internal_code`, `product_name`, `option_name`, `category`, `brand`, `cost_price`, `sale_price`, `stock_quantity`, `safety_stock`, `location`, `memo`, `image_url`, `status`를 사용합니다.

엑셀 업로드는 `.xlsx`, `.xls` 파일을 지원합니다. 포카마켓 양식은 `상품번호`를 SKU로 사용하고, `재고`, `그룹명`, `앨범명`, `멤버`, `포카마켓 이미지`, `포카마켓 가격` 컬럼을 자동으로 상품 DB 필드에 맞춥니다. 업로드로 재고가 새로 들어오거나 변경되면 `inventory_movements`에 `IN` 또는 `ADJUST` 이력이 남습니다.

## 검증

```bash
npm test
npm run lint
npm run build
```

`dev`와 `build`는 `--webpack`을 사용합니다. 현재 Next.js/Turbopack은 Windows의 한글 경로에서 production build panic이 발생할 수 있어 webpack을 기본값으로 고정했습니다.

## GitHub 업로드

`.env`, `node_modules`, `.next`, `dist`, `coverage`, 로그 파일, Prisma generated client는 commit 대상에서 제외합니다. 실제 secret 값은 GitHub에 올리지 말고 GitHub/Vercel 환경 변수에만 등록하세요.

처음 GitHub 저장소를 만든 뒤 아래 명령으로 연결합니다.

```bash
git remote add origin https://github.com/OWNER/REPOSITORY.git
git branch -M main
git push -u origin main
```

## 배포

### Vercel + Supabase

1. GitHub에 저장소를 업로드합니다.
2. Supabase에서 PostgreSQL 프로젝트를 생성합니다.
3. Vercel에서 GitHub 저장소를 Import 합니다.
4. Vercel 프로젝트 환경 변수에 아래 값을 등록합니다.
5. `DATABASE_URL`은 Supabase connection string을 사용합니다.
6. 배포 후 `npm run db:deploy`를 실행할 수 있도록 CI/CD 또는 로컬 터미널에서 migration을 적용합니다.
7. eBay Developer Console에 운영 OAuth callback URL을 추가합니다.
8. eBay Developer Console에 Marketplace account deletion notification endpoint로 `https://배포도메인/api/ebay/deletion`을 추가하고, Vercel 환경 변수에 `EBAY_DELETION_VERIFICATION_TOKEN`을 등록합니다.

Vercel 환경 변수 목록:

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `DATABASE_URL` | 예 | PostgreSQL 연결 문자열 |
| `SESSION_SECRET` | 예 | 관리자 세션 JWT 서명 secret |
| `TOKEN_ENCRYPTION_KEY` | 예 | eBay token 암호화용 32바이트 base64 키 |
| `ADMIN_LOGIN_ID` | 예 | 초기 관리자 로그인 ID |
| `ADMIN_PASSWORD` | 예 | 초기 관리자 비밀번호 |
| `EBAY_ENV` | 예 | `production` 또는 `sandbox` |
| `EBAY_CLIENT_ID` | 예 | eBay Developer App Client ID |
| `EBAY_CLIENT_SECRET` | 예 | eBay Developer App Client Secret |
| `EBAY_RU_NAME` | 예 | eBay Developer Console에서 발급한 RuName |
| `EBAY_SCOPES` | 아니오 | 기본 scope 외 추가/변경이 필요할 때 사용 |
| `EBAY_DELETION_VERIFICATION_TOKEN` | 예 | eBay Marketplace account deletion 검증 token |
| `EBAY_DELETION_ENDPOINT_URL` | 권장 | eBay에 등록한 정확한 삭제 알림 endpoint URL |

### Docker/VPS

1. PostgreSQL을 먼저 준비합니다.
2. 서버 환경 변수에 `.env.example` 항목을 등록합니다.
3. 빌드 후 `npm run db:deploy`, `npm run start` 순서로 실행합니다.

## 참고

현재 구현 범위는 주문 조회, 송장 등록, 배송 완료 처리, 상품 DB, 기본 재고 이동 관리입니다. 라벨 출력과 창고 자동화 API 연동은 이후 단계로 분리하는 것을 권장합니다.
