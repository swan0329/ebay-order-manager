# 요청과 외부 연결 계약

## 공통 규칙

브라우저용 경로는 서명된 HTTP 전용 세션 쿠키를 사용한다. 별도 표시가 없는 `/api` 경로는 관리자 전용이다. Android·로컬 AI 작업자는 관리자 쿠키 대신 각 전용 Bearer 토큰을 사용한다. 인증 실패는 변경 없이 `401`, 입력 검증 실패는 `400` 또는 `422`, 대상 없음은 `404`, 충돌은 `409`, 정리된 내부·외부 실패는 `500` 계열과 `{ "error": "설명" }`을 반환한다. 파일 내려받기는 JSON 대신 CSV 또는 XLSX 본문과 파일 이름 헤더를 반환한다.

## 인증과 상태

| 호출 | 입력 | 정상 결과 | 주요 실패 |
|---|---|---|---|
| `POST /api/auth/login` | JSON `loginId`, `password` | 세션 쿠키와 사용자 요약 | 잘못된 입력·자격증명 |
| `POST /api/auth/logout` | 세션 쿠키 | 쿠키 삭제 | 서버 실패 |
| `GET /api/auth/me` | 세션 쿠키 | 현재 사용자 또는 비로그인 상태 | 잘못된 세션 |
| `GET /api/health` | 없음 | 서버 상태 JSON | 데이터베이스 장애 |
| `GET /api/cron/keepalive` | `Authorization: Bearer <CRON_SECRET>` | 상태 확인 JSON | 토큰 불일치 |
| `GET /api/cron/orders-sync` | `Authorization: Bearer <CRON_SECRET>` | eBay·Shopify 주문 증분 수집 결과 | 토큰 불일치·채널별 수집 실패 |
| `GET /api/settlements/reconcile?days=30` | 관리자 세션, 1~90일 | 주문번호 기준 eBay·Shopify 실제 정산 대조 | 채널 정산 권한 없음·외부 조회 실패 |

## 상품·재고·주문

| 호출군 | 입력 | 정상 결과 | 주요 실패 |
|---|---|---|---|
| `GET/POST /api/products`, `GET/PATCH /api/products/[id]`, `PATCH /api/products/bulk` | 검색·페이지·필터 또는 검증된 상품 필드와 ID | 상품 목록·상세·변경 건수 | 잘못된 상태·중복 SKU·대상 없음 |
| `GET /api/products/facets`, `GET /api/products/stats` | 현재 필터 | 필터 선택지·집계 | 잘못된 필터 |
| `POST /api/import/products`, `POST /api/import/products/batch` | CSV/XLSX 파일 또는 행 묶음 | 생성·수정·건너뜀 결과 | 헤더·형식·행 검증 실패 |
| `POST /api/inventory/movement`, `GET /api/inventory/movements` | 상품 ID, `IN|OUT|ADJUST|ORDER_DEDUCT|CANCEL_RESTORE`, 수량·사유 또는 조회 필터 | 변경 전후 수량·이력 | 음수 재고·대상 없음 |
| `POST /api/orders/sync` | 동기화 범위 | 저장·갱신된 주문 수 | eBay 연결·조회 실패 |
| `POST /api/orders/[id]/match-product` | 주문 항목과 상품 ID | 확정 연결 | 주문·상품 없음 |
| `POST /api/orders/[id]/deduct-stock` | 주문 ID | 차감·건너뜀·부족·미연결 수 | 중복은 건너뜀, 음수는 거부 |
| `POST /api/orders/[id]/fulfillments`, `POST /api/shipments/bulk` | 운송사·송장번호·출고 시각 | eBay fulfillment와 내부 배송 상태 | 취소 주문·중복 송장·eBay 실패 |

`GET /api/export/products`, `/api/export/orders`, `/api/export/inventory-movements`, `/api/export/ebay-listings`는 현재 필터를 받아 파일을 반환한다. 내보내기 실패 시 부분 파일을 성공 응답으로 보내지 않는다.

`POST /api/ebay/active-report`는 관리자가 내려받은 eBay 활성상품 CSV/XLSX를 받아 SKU와 Item ID를 연결한다. `completeSnapshot=true`는 전체 활성상품 보고서임을 사람이 확인한 경우에만 사용하며, 이때 보고서에 없는 기존 활성 Item ID를 종료 상태로 바꾼다. `GET /api/ebay/active-report`는 최근 가져오기 결과와 미연결·중복·충돌 항목을 반환한다.

`GET /api/export/ebay-operations?type=revise|end|review`는 각각 가격·수량 변경, 판매중단, SKU·Item ID 연결 검토용 XLSX를 반환한다. 외부 eBay 변경은 수행하지 않는다.

신규등록용 `/api/export/ebay-listings`와 `/api/listing-upload/inventory/export`는 최근 전체 활성상품 보고서가 있어야 한다. 대상은 공급 가능, 이미지 완료, 판매가 확정 가능, eBay 비활성·미연결 조건을 모두 만족해야 하며 포카마켓 조달판매 수량은 1로 제한한다. Lens CSV는 같은 조건 중 Lens 승인 이미지를 쓰는 상품만 포함한다.

판매가는 두 파일 모두 `src/lib/listing-price.ts`가 정한다. 포카마켓 가격(`sale_price`, KRW)이 있으면 언제나 마진 계산가를 쓰고, 포카마켓에 없는 상품만 사람이 입력한 eBay 판매가(`ebay_price`, USD)를 그대로 쓴다. 두 값이 모두 없는 상품은 파일에서 제외하며, 남는 대상이 없으면 파일 대신 `422`와 안내 문구를 반환한다.

`POST /api/products/ebay-price`는 관리자 세션으로 상품별 수동 eBay 판매가(USD)를 최대 500건까지 한 번에 저장한다. 값이 비어 있으면 가격을 지우고, 0 이하·상한 초과는 `422`로 거부하며, 없는 상품이 섞이면 `404`로 아무것도 저장하지 않는다. 이 요청은 저장만 하고 eBay에 게시하지 않는다. `POST /api/pricing/recommend`는 원화 금액과 저장된 가격 설정으로 권장 판매가(USD)를 계산해 보여줄 뿐 아무것도 저장하지 않는다.

## eBay 연결과 등록

| 호출군 | 입력 | 정상 결과 | 주요 실패 |
|---|---|---|---|
| `GET /api/ebay/oauth/start`, `/oauth/callback`, `POST /oauth/manual-code` | 환경·승인 코드 | 승인 URL 또는 저장된 연결 결과 | state 불일치·코드 만료·환경 불일치 |
| `GET /api/ebay/connection-status` | 관리자 세션 | 환경별 연결 상태와 만료 정보 | 미연결 |
| `GET /api/ebay/deletion` | eBay `challenge_code` | eBay 규격 challenge 응답 | 토큰·URL 불일치 |
| `GET /api/listings/policies`, `GET /api/listing-upload/policies`, `POST /policies/sync` | 마켓·정책 유형 | eBay 정책 목록·동기화 결과 | scope 부족·eBay 실패 |
| `GET/POST/PUT /api/listings/templates...` | 템플릿 ID와 검증된 기본값 | 템플릿·복사·기본 설정 결과 | 이름·금액·정책 검증 실패 |
| `GET/PATCH/POST /api/listing-upload/drafts...` | 초안 필터, ID, 상품·파일·일괄 변경 내용 | 초안, 검증 결과, 업로드 작업 | 필수 필드·상태 전이·정책 실패 |
| `POST /api/listings/upload/single`, `/excel`, `/retry`; `GET /jobs`, `/preview`, `/sample` | 상품·파일·작업 ID | payload 미리보기 또는 외부 offer/item ID | 이미지·카테고리·scope·외부 오류 |
| `GET /api/listing-upload/taxonomy/aspects`, `/promoted/campaigns` | 마켓·카테고리 | 필수 속성 또는 캠페인 | 잘못된 카테고리·scope 부족 |

등록 성공은 외부 offer/item ID와 최종 payload를 내부 작업에 기록한다. 성공 후 응답만 실패한 재시도는 외부 ID를 먼저 조회하며 같은 상품을 중복 게시하지 않는다.

`POST /api/listing-upload/drafts/upload`는 최대 50개 초안을 받는다. `dryRun=true`로 중복·이미지 지문·필수값을 검증해 서명된 미리보기 토큰을 받은 뒤, 같은 대상으로 `confirmed=true`, `dryRun=false`를 보내야 실제 게시한다.

`GET /api/ebay/operations`는 신규등록·가격/재고 변동·품절/판매중지 대상을 현재 내부 값과 마지막 eBay 전송값으로 분류한다. `POST /api/ebay/operations`는 선택한 변동 또는 품절 항목을 먼저 `dryRun=true`로 보여 주며, 실제 전송은 `confirmed=true`가 필요하다.

`GET /api/ebay/operations?channel=EBAY|SHOPIFY`는 마켓별 연결 상태와 마지막 전송값을 독립적으로 비교한다. `POST`에도 같은 `channel`을 보내며 미리보기 토큰은 선택 상품과 채널 실행 경로에서 확인된다. Shopify 신규등록·변동·품절은 Shopify 상품/재고 API만 호출하고 eBay에는 쓰지 않는다.

eBay `IMAGE_REPAIR`는 최신 전체 활성상품 보고서에서 부모 Item ID가 확인되고 모든 옵션의 최종 승인 이미지가 준비된 묶음만 반환한다. 실행은 서명된 미리보기와 관리자 확인 후 현재 워터마크 설정으로 대표 썸네일을 R2에 만들고 `ReviseFixedPriceItem`의 `PictureDetails`만 전송한다. 옵션 구성과 옵션별 사진은 이 요청에 포함하지 않는다.

묶음 eBay 리스팅에 포함된 상품의 재고·품절은 최신 전체 활성상품 보고서에 부모 Item ID가 실제 존재할 때만 부모 Item ID와 옵션 SKU의 조합으로 수정한다. 저장된 과거 묶음 Item ID만으로 활성이라고 추정하지 않는다. 옵션 하나가 품절됐다는 이유로 부모 리스팅 전체를 종료하지 않으며, 화면과 미리보기에서 `옵션 품절`과 `단품 품절`을 구분한다. 내부 상품 상태가 비활성이면 전송 수량은 반드시 0이다.

기존 리스팅의 품절 판정은 내 판매 가능 재고(내 재고 - 미처리 주문 예약 - 안전재고)와 최신 포카마켓 빠른구매 재고를 함께 본다. 둘 다 0인 경우만 `품절`이며, 내 재고가 예약·안전재고 때문에 0이 된 경우는 `판매 보류`로 구분한다. 포카마켓 관측값이 없거나 24시간을 넘긴 경우는 `포카마켓 재고 확인 필요`로 표시하고 자동 전송 대상에서 제외한다. 조달 판매분은 매물 변동 위험 때문에 최대 1장만 채널 수량에 더한다.

Shopify 신규등록 수는 카드 수가 아니라 실제 생성할 리스팅 수다. 최종 승인 이미지와 가격·공급 조건을 만족한 카드를 같은 그룹·앨범·버전별로 묶어 하나의 Shopify 상품과 여러 옵션으로 만들고, 묶을 수 없는 카드만 단품으로 센다. 묶음의 각 상품은 같은 Shopify Product ID와 서로 다른 Variant/Inventory Item ID를 저장하며 이후 가격·재고·품절도 옵션 단위로 동기화한다.

eBay `신규등록` 건수는 조회 상한이나 단순 상품 후보 수가 아니라 `ListingDraft.status=validated`이고 활성 eBay Item ID가 없는 최신 상품별 초안 수다. 초안·실패 상태는 별도 검토 수로만 보여 주며, 미리보기 요청이 초안을 자동 생성하거나 검증 실패 상품을 등록 대상으로 승격하지 않는다. 미리보기 응답은 SKU·제목·가격·수량·이미지 수·항목별 검증 사유와 예상 처리시간 범위를 반환한다.

`GET/PUT /api/automation/rules`는 재고 0 리스팅 규칙과 최근 이벤트를 다룬다. 기본 모드는 `NOTIFY`이며 `AUTOMATIC` 저장은 현재 대상 미리보기와 명시적 확인을 요구한다.

## 이미지

| 호출군 | 입력 | 정상 결과 | 주요 실패 |
|---|---|---|---|
| `POST /api/inventory/image-match`, `/confirm-image-match`, `/confirm-photo-card-image` | 상품·후보 ID와 승인 선택 | 후보 목록 또는 사람 확정 결과 | 후보 없음·이미 확정·잘못된 상품 |
| `GET /api/inventory/photo-card-candidates`, `/group-members`, `/featured-members` | 상품·그룹·검색 조건 | 후보·그룹 목록 | 잘못된 식별자 |
| `GET/POST /api/inventory/photo-card-r2-upload` | 조회 조건 또는 이미지 파일·면 | 저장 URL·키 | 형식·크기·R2 실패 |
| `POST /api/inventory/delete-r2-photo-card-image` | `product_id` 또는 `productId`, `side` | 참조 정리와 삭제 결과 | `401`, 잘못된 면 `422`, R2 실패 `500` |
| `GET/POST /api/products/[id]/image-workbench...`, `GET/POST /api/products/image-workbench/settings` | 상품 ID, 분석·편집 설정 | 분석 후보·미리보기·저장 설정 | 원본 없음·분석 실패 |
| `GET/POST /api/products/image-match...` | 상품 ID·면·검색 이미지·확정값 | 검색 결과, 프록시 이미지 또는 확정 연결 | 이미지 없음·지원하지 않는 면 |
| `POST /api/image-workers` | 관리자 세션, `loginId`, `name`, `password` | `201`과 생성된 작업자 계정 요약 | 관리자 아님 `401`, 중복 ID `409`, 잘못된 값 `422` |
| `PATCH /api/image-workers` | 관리자 세션, `workerId`, `productIds` | 기존 배정을 덮어쓴 상품 작업 배정 결과 | 관리자 아님 `401`, 작업자 없음 `404`, 잘못된 값 `422`, 데이터베이스 실패 `500` |
| `POST /api/image-reviews` | 관리자 세션, 작업 ID, 승인 또는 거절과 검토 내용 | 검토 상태와 적용 결과 | 관리자 아님·작업 없음·이미 처리됨 |
| `POST /api/ai-image-work` | 관리자 세션 또는 허용된 로컬 작업자 토큰, 작업 명령·상태·미리보기 | 생성·배정·처리된 AI 작업 상태 | 인증 실패·작업 없음·잘못된 상태 전이 |

AI 결과는 승인 전 상품 이미지 URL을 바꾸지 않는다. 이미지 프록시와 R2 응답에는 인증정보를 포함하지 않는다.

AI 이미지 자동 처리는 서버 전용 `DEWATERMARK_API_KEY`를 사용해
`https://platform.dewatermark.ai`의 이미지 워터마크 제거 API를 호출한다. API 키와
외부 원본 응답은 브라우저·일반 로그·작업 오류에 포함하지 않는다. 외부 처리 결과는
검수용 R2 이미지로만 저장하며 관리자가 통과 및 최종 업로드를 명시적으로 확인하기
전에는 상품 이미지를 변경하지 않는다.

## 포카마켓

`GET /api/pocamarket-bridge/jobs`는 전용 Bearer 토큰과 기기 식별자를 받아 다음 대기 작업의 ID, 상품번호, 수량, 기준가, 최대 허용가를 반환한다. `PATCH /api/pocamarket-bridge/jobs/[id]`는 상태, 발견 가격, 구매 수량, 경고·오류를 받아 갱신한다. 잘못된 토큰은 `401`, 존재하지 않거나 허용되지 않은 상태 변경은 `404/409`, 잘못된 값은 `422`다.

`POST /api/pocamarket-bridge/reconcile`은 전용 연결 상태와 서버 작업을 대조하고 정리 결과를 반환한다. 결제 세션·카드정보·앱 인증정보를 주고받지 않는다.

`GET/POST /api/pocamarket-purchases`는 관리자에게 주문별 구매 작업을 보여주거나 재고 부족분의 구매 작업을 만든다. `POST /api/pocamarket-purchases/[id]/confirm-unit`은 사람이 확인한 단위 구매 진행을 승인한다. 배송 대기 주문이 아니거나 재고 부족이 없거나 가격 기준이 없으면 작업을 만들지 않는다.

## Shopify와 관리 작업

`POST /api/products/[id]/shopify-upload`는 관리자 세션과 상품 ID를 받아 Shopify 상품·변형·재고 항목 ID를 반환한다. 실패하면 내부 재고나 eBay 상태를 바꾸지 않고 상품의 Shopify 실패 상태를 기록한다.

`/api/admin/*`는 관리자 전용 진단·일괄 작업이다. GET 경로는 임베딩 진행·정체·이미지·R2 상태를 조회하고, POST 경로는 명시된 마이그레이션·정규화·최적화·임베딩 생성 작업을 시작한다. 권한 없음은 `401`, 입력이 있는 작업의 잘못된 범위는 `422`, 실패는 정리된 `500` 계열 오류다.

현재 `POST /api/admin/migrate-listing-upload`, `/migrate-listing-templates`, `/migrate-product-matching`, `/migrate-shopify`, `/optimize-orders`, `/optimize-products`, `/normalize-product-status` 중 일부는 요청 인자 없이 전체 데이터 구조나 전체 대상에 작용한다. 호출 전 데이터베이스 백업과 실행 대상 확인이 필요하며, 일반 화면이나 예약 작업에서 자동 호출하면 안 된다. 응답은 완료 메시지 또는 처리 결과를 반환하지만 전체 작업의 원자적 복구를 약속하지 않는다.
