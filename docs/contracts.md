# 요청과 외부 연결 계약

## 2026-09-15 가격 안전성 확인 보강

`GET /api/pocamarket-sync/safety`는 관리자에게 판매 연결 상품의 별도 공급처 관측 이력 대조 결과 `evidenceMatched`, `evidenceMismatch`, `evidenceMismatchSkus`를 추가 반환한다. 이 값은 원가 증거 대조이며 외부 판매 보류 완료 수가 아니다.

`GET /api/products?skus=296333,284272`는 쉼표로 구분한 정확한 SKU 1~500개를 조회한다. 기존 검색·그룹·재고 필터와 관리자 권한은 유지하며 잘못된 크기·빈 SKU는 422다. 전수 대조에서 부분 문자열 검색으로 다른 상품이 섞이거나 500행 제한에 잘리는 일을 피하기 위한 읽기 전용 경로다.

eBay revise Feed의 제출 수량은 0이며 저장된 목표 수량은 재개 희망값이다. 결과 처리에서 최신 원가를 다시 읽고 정확한 판매 옵션의 가격·수량 0을 외부 재조회로 확인한 후 수량을 복구한다. Inventory와 기존 Trading 등록을 모두 처리한다. Feed 실패·결과 누락·실제 검증 실패는 옵션 보류를 시도하고, 보류 확인 실패는 별도 실패 사유로 남긴다. 내부 재고는 바꾸지 않는다.

Shopify 가격·수량 변경은 해당 옵션의 실제 0·재고 추적·초과판매 금지 확인을 선행한다. 실제 가격 조회가 맞아야 수량을 복구하며 최종 가격·수량 확인 후만 보류 표식을 해제한다. 중간 실패 시 다시 보류하고, 외부 장애로 보류도 확인할 수 없으면 보류 미확인 오류를 반환한다.

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

## 상품·재고·주문

| 호출군 | 입력 | 정상 결과 | 주요 실패 |
|---|---|---|---|
| `GET/POST /api/products`, `GET/PATCH /api/products/[id]`, `PATCH /api/products/bulk` | 검색·페이지·필터 또는 검증된 상품 필드와 ID | 상품 목록·상세·변경 건수 | 잘못된 상태·중복 SKU·대상 없음 |
| `GET /api/products/facets`, `GET /api/products/stats` | 현재 필터 | 필터 선택지·집계 | 잘못된 필터 |
| `POST /api/import/products`, `POST /api/import/products/batch` | CSV/XLSX 파일 또는 행 묶음 | 생성·수정·건너뜀 결과 | 헤더·형식·행 검증 실패 |
| `POST /api/inventory/movement`, `GET /api/inventory/movements` | 상품 ID, `IN|OUT|ADJUST|ORDER_DEDUCT|CANCEL_RESTORE`, 수량·사유 또는 조회 필터 | 변경 전후 수량·이력 | 음수 재고·대상 없음 |
| `POST /api/orders/sync` | `channel=EBAY|SHOPIFY`와 동기화 범위 | 채널별 저장·갱신된 주문 수 | eBay 연결 또는 Shopify `read_orders` 권한·조회 실패 |
| `POST /api/orders/[id]/match-product` | 주문 항목과 상품 ID | 확정 연결 | 주문·상품 없음 |
| `POST /api/orders/[id]/deduct-stock` | 주문 ID | 차감·건너뜀·부족·미연결 수 | 중복은 건너뜀, 음수는 거부 |
| `POST /api/orders/[id]/fulfillments`, `POST /api/shipments/bulk` | 운송사·송장번호·출고 시각 | eBay fulfillment와 내부 배송 상태 | 취소 주문·중복 송장·eBay 실패 |

`GET /api/export/products`, `/api/export/orders`, `/api/export/inventory-movements`, `/api/export/ebay-listings`는 현재 필터를 받아 파일을 반환한다. 내보내기 실패 시 부분 파일을 성공 응답으로 보내지 않는다.

`POST /api/ebay/active-report`는 관리자가 내려받은 eBay 활성상품 CSV/XLSX를 받아 SKU와 Item ID를 연결한다. `completeSnapshot=true`는 전체 활성상품 보고서임을 사람이 확인한 경우에만 사용하며, 이때 보고서에 없는 기존 활성 Item ID를 종료 상태로 바꾼다. `GET /api/ebay/active-report`는 최근 가져오기 결과와 미연결·중복·충돌 항목을 반환한다.

`GET /api/cron/ebay-active-report`는 `CRON_SECRET`으로 보호되며 5분마다 eBay Feed API의 `LMS_ACTIVE_INVENTORY_REPORT` 상태를 확인한다. 먼저 eBay는 완료됐지만 내부 결과 확정이 끝나지 않은 Feed 작업을 찾아 기존 결과 파일부터 재적용하고, 상품 변경을 eBay에 중복 제출하지 않는다. 완료된 ZIP/XML 결과는 전체 스냅샷으로 자동 가져오고, 같은 Item ID를 공유하는 옵션은 SKU별 행으로 보존한다. 등록 작업 성공 뒤에도 새 보고서를 예약한다. 변경 Feed보다 먼저 생성된 진행 중 보고서를 재사용한 경우에는 그 보고서를 가져온 직후 Feed 완료 시각보다 뒤에 생성되는 확인 보고서를 한 번 더 강제 예약한다. 이전 배포가 오래된 보고서를 이미 가져온 경우도 eBay 작업 생성 시각을 다시 비교해 같은 복구 예약을 수행한다. 진행 중 작업 재사용·4시간 신선도·일일 20건 상한으로 그 밖의 중복 요청과 보고서 생성을 제한한다. 수동 CSV/XLSX 업로드는 자동 수집 장애 시 보조 수단이다.

`GET /api/export/ebay-operations?type=revise|end|review`는 각각 가격·수량 변경, 판매중단, SKU·Item ID 연결 검토용 XLSX를 반환한다. 검토 후 관리자가 화면에서 명시적으로 확인한 `POST /api/ebay/operations`는 eBay Feed API에 가격·수량 변경 또는 판매중단 작업을 제출한다. 미국 마켓 등록 작업은 Feed API의 createTask와 uploadFile 요청에 `X-EBAY-C-MARKETPLACE-ID: EBAY_US`를 함께 보낸다. eBay가 작업 ID를 만들기 전에 제출이 실패한 경우에는 같은 검증 대상 작업을 안전하게 다시 제출할 수 있다. `GET /api/ebay/operations?jobId=...`는 eBay 처리 상태와 결과 파일을 자동 확인한다. 수백 건의 결과 저장은 상품별 대화형 트랜잭션 반복 대신 성공 ID와 동일 오류 ID를 `updateMany`로 묶고 작업 결과와 함께 짧은 배치 트랜잭션으로 확정한다. eBay 완료 상태를 받았지만 내부 확정 트랜잭션이 끝나지 않은 작업은 결과 파일부터 안전하게 다시 적용한다. Feed 성공은 요청 처리 결과로만 기록하고 최근 eBay 스냅샷을 성공값으로 덮어쓰지 않는다. 성공 뒤 새 Active Inventory Report를 요청하며, 실제 가격·수량 또는 종료가 새 보고서에서 확인된 상품만 작업 대상 수에서 제외한다. 같은 보고서 기준의 중복 제출은 기존 작업을 반환하고 새 보고서에서도 불일치가 남으면 새 작업으로 재시도할 수 있다.

신규등록용 `/api/export/ebay-listings`와 `/api/listing-upload/inventory/export`는 최근 전체 활성상품 보고서가 있어야 한다. 대상은 공급 가능, 이미지 완료, 판매가 확정 가능, eBay 비활성·미연결 조건을 모두 만족해야 하며 포카마켓 조달판매 수량은 1로 제한한다. Lens CSV는 같은 조건 중 Lens 승인 이미지를 쓰는 상품만 포함한다.

판매채널 가격은 모두 `src/lib/listing-price.ts`가 정한다. 포카마켓 가격(`sale_price`, KRW)이 있으면 마진 계산가를 자동으로 반환하고, 없으면 직접 입력해 저장한 USD 판매가(`final_listing_price_usd`)를 반환한다. 두 값이 모두 없으면 등록·가격변동 대상에서 제외하고, 남는 대상이 없으면 파일 대신 `422`와 안내 문구를 반환한다. 직접입력 USD 가격의 변경은 `listing_price_approvals` 이력에 승인자·시각·근거와 함께 보존한다.

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

`POST /api/ebay/inventory-location`은 관리자가 한국 발송지 우편번호 5자리, 영문 도시, 영문 시/도와 `confirmed=true`를 제출한 경우에만 eBay Inventory API에 활성 `WAREHOUSE` 위치를 만든다. 국가·우편번호만 있는 기존 위치는 eBay 게시 단계에서 유효하지 않을 수 있으므로 재사용하지 않고, 도시·시/도까지 일치하는 활성 위치만 재사용한다. 성공 뒤 정책·위치 캐시를 다시 동기화한다.

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
| `POST /api/admin/shopify-link-check` | 관리자 세션, 상품번호 1~50개 | 저장된 Shopify 연결과 실제 옵션·상위 상품 값 비교 결과 | 인증 실패·Shopify 설정 누락 |
| `GET /api/admin/db-latency` | 관리자 세션 | 데이터베이스 호스트·연결 설정과 `SELECT 1` 왕복 시간 표본 | 인증 실패·연결 실패 |
| `POST /api/admin/r2-usage` | 관리자 세션, 이어보기 cursor와 시간 예산 | 용도별 객체 수·용량과 어떤 기록도 가리키지 않는 파일 수·용량, 30·90일 경과 분포 | 인증 실패·R2 설정 누락 |
| `POST /api/ai-image-work` | 관리자 세션 또는 허용된 로컬 작업자 토큰, 작업 명령·상태·미리보기·처리 예정 목록 조회·작업 제외/해제(상품 ID 최대 200개)·구글렌즈 후보 주소 저장 | 생성·배정·처리된 AI 작업 상태, 처리 예정·제외 목록과 전체 개수 | 인증 실패·작업 없음·잘못된 상태 전이·제외할 수 없는 상태 |

AI 결과는 승인 전 상품 이미지 URL을 바꾸지 않는다. 이미지 프록시와 R2 응답에는 인증정보를 포함하지 않는다.

판매채널 업로드는 촬영본 연결 이미지 또는 승인된 이미지 작업 결과 한 장을 기본 원본으로 선택하고, 저장된 `워터마크 설정`으로 생성한 공용 R2 URL을 eBay와 Shopify에 동일하게 전달한다. `image_source='lens_workbench'`이면 승인된 가공 결과 `imageUrl`을 과거 `userFrontImageUrl`보다 우선한다. 회전·확대·반전과 노출·대비·채도는 두 원본 유형에 공통 적용한다. 이미지 축소는 원본 가로세로 비율을 보존하는 `contain` 방식이며 가공 결과의 JPEG 흰 모서리는 4.5% 라운드 마스크로 투명화한다. 축소·방향별 패딩·사용자 배경은 별도 활성화 값과 무관하게 `image_source='lens_workbench'`인 승인 이미지작업 결과에 항상 합성하고 촬영본 연결 이미지에는 합성하지 않는다. 그림자는 합성하지 않으며 모든 효과 뒤 워터마크를 마지막에 적용한다. 워터마크 로고는 이미지 정중앙을 기준으로 한 고정 격자에 배치한다. 화면의 `반복 중심 간격`은 로고 중심 사이 거리이므로 크기를 바꿔도 패턴 위치와 밀도가 유지되며, 내부 테두리 여백 값은 이 거리 계산에만 사용한다. `GET /api/channel-publishing/image-settings`의 미리보기 전용 샘플은 최근 승인 이미지작업 이력과 촬영본을 유형별 최대 30개 반환하며, 즉시 화면 전환을 위해 검증된 원본 URL과 원본 유형을 함께 제공한다. 이미지작업 이력 ID를 지정한 미리보기 요청만 해당 과거 승인본을 사용한다. 이 샘플 선택은 실제 채널 업로드 원본 선정에는 영향을 주지 않는다. `POST /api/channel-publishing/image-settings?mode=live`는 설정을 저장하거나 R2 객체를 만들지 않고 같은 렌더러의 JPEG 미리보기를 `no-store`로 반환한다. `mode=source`는 즉시 편집 캔버스에 승인 원본 URL과 배경 적용 가능 여부만 반환한다. 기존 `ebayImageUrls`, Shopify Admin 미디어, 자동 매칭·검수 후보에 포함됐다는 이유만으로 추가 이미지를 게시하지 않는다. 옵션 대표 썸네일도 같은 설정과 원본 유형 판정을 사용한다.

외부 미디어 조회 응답은 관리 객체 상태를 뜻하며 공개 노출을 보장하지 않는다. 공개 상품 URL에서 확인하지 않은 경우 응답과 화면 문구는 `연결된 외부 상품의 미디어`로 표시하고 `실제 게시 이미지`로 표시하지 않는다.

AI 이미지 자동 처리는 서버 전용 `DEWATERMARK_API_KEY`를 사용해
`https://platform.dewatermark.ai`의 이미지 워터마크 제거 API를 호출한다. API 키와
외부 원본 응답은 브라우저·일반 로그·작업 오류에 포함하지 않는다. 외부 처리 결과는
검수용 R2 이미지로만 저장하며 관리자가 통과 및 최종 업로드를 명시적으로 확인하기
전에는 상품 이미지를 변경하지 않는다.

## 포카마켓

`GET /api/pocamarket-bridge/jobs`는 전용 Bearer 토큰과 기기 식별자를 받아 다음 대기 작업의 ID, 상품번호, 수량, 기준가, 최대 허용가를 반환한다. `PATCH /api/pocamarket-bridge/jobs/[id]`는 상태, 발견 가격, 구매 수량, 경고·오류를 받아 갱신한다. 잘못된 토큰은 `401`, 존재하지 않거나 허용되지 않은 상태 변경은 `404/409`, 잘못된 값은 `422`다.

`POST /api/pocamarket-bridge/reconcile`은 전용 연결 상태와 서버 작업을 대조하고 정리 결과를 반환한다. 결제 세션·카드정보·앱 인증정보를 주고받지 않는다.

로컬 `pocamarket-phone-connect.mjs`는 `127.0.0.1`에만 연결 페이지를 열고 ADB mDNS로 페어링·연결 주소를 먼저 찾는다. 페어링 코드와 주소는 배포 서버로 보내지 않으며, 같은 로컬 페이지의 요청만 ADB 페어링과 연결을 실행할 수 있다. 성공한 연결 주소만 로컬 설정에 저장하고 일회용 페어링 코드는 저장하지 않는다.

`GET/POST /api/pocamarket-purchases`는 관리자에게 휴대전화 구매 작업을 보여주거나 만든다. `orderId`는 배송대기 주문의 부족분을 계산하고, `productId`와 `requestedQuantity`(1~20)는 주문이 없어도 지정 상품을 구매 대기열에 넣는다. 상품별 구매를 별도 보유재고 분류로 관리하지 않으며 같은 상품의 진행 중 작업은 중복 생성하지 않는다. `POST /api/pocamarket-purchases/[id]/confirm-unit`은 사람이 확인한 단위 구매 진행을 승인한다. 포카마켓 품절 또는 기준가격 없음은 거부하고, 구매 완료만으로 내부 재고를 증가시키지 않는다. 실제 수령 뒤 관리자가 재고 이동으로 수량을 추가한다.

## Shopify와 관리 작업

Shopify 주문 수집은 Admin GraphQL API의 `orders`를 페이지 단위로 읽고, Shopify 주문 ID와 라인아이템 ID를 중복 방지 키로 저장한다. 최근 60일을 넘는 주문은 Shopify 앱의 `read_all_orders` 승인이 추가로 필요하다. 취소 주문을 다시 수집하면 이미 차감된 재고를 이력과 함께 원자적으로 복구한다.

`POST /api/products/[id]/shopify-upload`는 관리자 세션과 상품 ID를 받아 Shopify 상품·변형·재고 항목 ID를 반환한다. 실패하면 내부 재고나 eBay 상태를 바꾸지 않고 상품의 Shopify 실패 상태를 기록한다.

`GET /api/products/[id]/shopify-link`는 관리자 세션과 저장된 Shopify 상품 ID로 현재 공개 상품 URL을 조회해 이동한다. 상품이 비공개이거나 공개 URL이 없으면 Shopify 관리자 상품 주소를 사용하며, 연결이 없거나 조회가 실패하면 외부 원본 오류를 숨긴 JSON 오류를 반환한다.

Shopify 신규등록은 로컬 Shopify ID가 없을 때 SKU를 먼저 조회한다. 정확히 일치하는 기존 variant가 하나면 해당 상품·variant·inventory ID를 회수해 수정하며, 같은 SKU가 둘 이상이면 중복 생성하지 않고 `409`로 중단한다. 실제 신규 상품은 GraphQL `productSet`으로 상품 정보·이미지·가격·재고·표준 카테고리를 한 요청에 등록한다. 폐기 방향인 REST Product 생성과 별도 재고·카테고리 호출을 신규 경로에서 사용하지 않는다. 가격·재고 전용 요청은 전체 상품과 카테고리를 다시 쓰지 않는다.

`POST /api/channel-publish-jobs`는 관리자가 확인한 eBay draft ID 또는 Shopify 상품 ID를 최대 500개까지 받아 백그라운드 등록 작업을 만든다. 자동 미등록 상품 등록은 관리자가 `limit`으로 채널별 작업 수를 1~500개에서 직접 정하며 화면 기본값은 시험용 1개다. `DELETE /api/channel-publish-jobs`는 이미 성공한 외부 등록은 보존하고 아직 대기 중인 항목만 중단한다. Shopify는 `PRICE_INVENTORY`, `IMAGES`, `ARCHIVE` 모드를 구분하며, 이미지 교체는 새 승인 이미지를 먼저 준비한 뒤 기존 이미지를 삭제한다. `POST /api/shopify/operations`는 `revise` 또는 `end`를 받아 현재 연결된 Shopify 상품 전체의 가격·재고 반영 또는 품절 상품 판매중단 작업을 만든다. 가격·재고 변경은 쓰기 뒤 Shopify의 실제 variant 가격과 location 재고를 최대 3회 다시 조회하고 목표값과 모두 일치한 경우에만 성공 처리한다. 불일치 또는 재조회 실패 항목은 실패로 남아 다음 자동 반영 대상에서 제외되지 않는다. 판매중단은 삭제가 아니라 Shopify의 `ARCHIVED` 상태로 바꿔 되돌릴 수 있게 한다. `GET /api/channel-publish-jobs?jobId=...`는 각 항목이 끝나는 즉시 갱신된 처리·성공·실패 건수, 현재 처리 SKU, 실패 SKU를 반환하며 미완료 작업 조회는 중단된 작업자를 서버 내부에서 다시 깨운다. 실행은 `CRON_SECRET`이나 자기 자신을 향한 HTTP 요청에 의존하지 않는다. 작업별 DB lease로 실행기는 하나만 동작하고 한 번에 최대 3건만 선점한다. Shopify는 75초, eBay는 3분 넘게 멈춘 항목을 한 번만 다시 대기 상태로 돌리고 두 번째 제한 시간 초과는 실패로 확정한다. DB 연결 풀 대기는 한 번 자동 재시도하고, 브라우저에는 Prisma 원문 대신 정리된 사유를 반환한다. 외부 재시도는 eBay SKU/offer 선조회와 Shopify SKU 선조회로 중복 게시를 막는다.

`POST /api/products/publish`는 관리자가 최종 확인한 상품 ID와 `EBAY|SHOPIFY` 채널을 받아 옵션 묶음을 자동 판별한다. 묶음은 전체 현재 구성으로 채널의 옵션상품을 생성·갱신하고 필요한 썸네일만 자동 생성하며, 묶이지 않는 상품은 단품 등록 작업으로 보낸다. eBay는 Inventory Item Group, Shopify는 GraphQL `productSet`을 사용하고 성공한 각 옵션의 외부 상품·variant·inventory ID를 내부 상품에 저장한다.

eBay 자동 등록은 Shopify와 동일한 승인 완료 `ebayImageUrls` 갤러리를 우선 사용한다. 재시도 시 기존 Draft의 원본 이미지·짧은 설명을 그대로 재사용하지 않고 현재 승인 이미지, 기본 등록 템플릿을 변수 치환한 상세 HTML, 가격·수량·정책·재고 위치를 다시 스냅샷한다. 옵션상품도 각 카드의 승인 갤러리와 같은 기본 상세 템플릿을 Inventory Item과 Offer에 반영한다.

`GET /api/products/channel-operation-counts`는 판매채널 자동 반영 화면에 eBay·Shopify별 등록 가능, 가격·수량 변경, 판매중단 필요 상품 수를 반환한다. eBay 변경 수는 가격·수량·보고서 확인불가 원인별 수도 함께 반환한다. 일반 연결 검토가 남은 보고서 행이라도 사용자가 승인해 Feed로 보낸 정확한 Item ID와 SKU 조합이 최신 보고서에서 유일하게 일치하면 외부 상태 확인 근거로 사용하되 상품 연결 자체는 변경하지 않는다. 표시 수량은 각 실행 API와 동일한 대상 계산 함수를 사용하며 상품 상태가 바뀌거나 작업이 완료되면 클라이언트가 다시 계산한다.

eBay 옵션 전환은 기존 활성 단품이 Inventory API 객체가 아니면 `bulk_migrate_listing`으로 먼저 이관하고, 해당 offer를 철회한 뒤 옵션 묶음을 게시한다. 게시 실패 시 신규 묶음을 제거하거나 이전 묶음 구성으로 되돌리고 철회한 단품 offer를 다시 게시한다. Shopify 옵션 병합은 연결 수가 가장 많은 기존 상품을 대표로 선택하고 `productSet` 성공 후 다른 기존 상품을 `ARCHIVED`로 전환하며, 모든 카드의 product·variant·inventory ID를 대표 상품 결과로 갱신한다.

eBay Feed 결과 조회도 작업별 refresh lease를 사용해 여러 화면이나 느린 응답이 겹쳐도 eBay 상태 조회와 결과 파일 반영은 하나만 실행한다. 화면은 앞 조회가 끝난 뒤 다음 조회를 예약하며, Feed 원문 요청은 25초에 중단해 서버 함수와 DB 연결이 장시간 남지 않게 한다.

가격·수량 변경과 판매중단 Feed는 상품 ID를 각 요청의 `MessageID`로 보내고 응답의 `CorrelationID`로 결과를 연결한다. 실패 응답에 Item ID·SKU가 없어도 실제 오류 사유를 보존한다. 이전 결과는 Item ID·SKU 조합이 유일한 경우만 상품에 연결하며, 공통 Item ID만 있는 옵션 응답을 임의의 상품에 연결하지 않는다. 일부 상품만 처리 상태 확인불가로 남은 완료 작업도 기존 결과 파일부터 다시 읽고 변경 Feed를 재제출하지 않는다. 식별자가 없어 연결할 수 없는 실제 오류는 작업 오류에 별도로 표시하고, 이미 진단된 동일 오류는 예약 작업에서 반복 조회하지 않는다.

Item ID로 관리하는 단품의 가격·수량 변경은 내부 SKU를 전송하지 않는다. 내부 SKU와 eBay Custom Label이 다를 수 있기 때문이다. 등록된 옵션 묶음은 부모 Item ID와 옵션 SKU를 함께 전송한다. `POST /api/ebay/operations`의 `retryJobId`는 같은 관리자·작업 종류의 완료 작업에서 실패한 상품 중 현재도 변경이 필요하고 Item ID가 같은 상품만 대상으로 제한한다. `GET`의 `history=true`는 최근 본인 작업, `diagnose=true&jobId=...`는 외부 결과의 해석 요약을 반환한다. `verify=true&jobId=...`는 활성상품 보고서를 동기화한 뒤 요청 가격·수량과 비교한다. 보고서 작업의 eBay 생성 시각이 Feed 완료 이후이고 Item ID(옵션은 SKU도 포함)와 가격·수량이 일치할 때만 검증 성공으로 표시한다. 모든 조회는 관리자 세션과 작업 소유자 범위를 검사한다.

자동 활성상품 보고서는 eBay 생성 시각이 가장 최근인 완료 작업만 적용한다. 최신 결과를 이미 적용했다면 더 오래된 미수집 작업을 뒤늦게 가져오지 않는다. 이전 배포가 오래된 결과를 마지막에 적용한 상태는 최신 완료 결과를 다시 읽어 복구한다. 가격·수량 변경 필요 계산은 과거 단품의 상품 연결 보고서보다 현재 반영 대상의 정확한 Item ID+SKU 행을 우선한다.

`/api/admin/*`는 관리자 전용 진단·일괄 작업이다. GET 경로는 임베딩 진행·정체·이미지·R2 상태를 조회하고, POST 경로는 명시된 마이그레이션·정규화·최적화·임베딩 생성 작업을 시작한다. 권한 없음은 `401`, 입력이 있는 작업의 잘못된 범위는 `422`, 실패는 정리된 `500` 계열 오류다.

현재 `POST /api/admin/migrate-listing-upload`, `/migrate-listing-templates`, `/migrate-product-matching`, `/migrate-shopify`, `/optimize-orders`, `/optimize-products`, `/normalize-product-status` 중 일부는 요청 인자 없이 전체 데이터 구조나 전체 대상에 작용한다. 호출 전 데이터베이스 백업과 실행 대상 확인이 필요하며, 일반 화면이나 예약 작업에서 자동 호출하면 안 된다. 응답은 완료 메시지 또는 처리 결과를 반환하지만 전체 작업의 원자적 복구를 약속하지 않는다.

## 포카마켓 신상품 수집 API

2026-09-15 가격 사고 추적 보완: `GET /api/ebay/operations?history=true&sku=...`는 관리자 본인 작업 중 정확한 SKU가 포함된 과거 이력을 최대 100개 반환한다. SKU는 공백 제거 후 1~100자이며, 미지정 시 기존 최근 20개 조회다. 작업 응답에 생성 시각과 저장 대상의 가격·수량을 포함하며 원본 인증정보나 외부 요청 토큰은 반환하지 않는다. 읽기만 수행하고 과거 작업을 재실행하지 않는다.

`GET /api/pocamarket-catalog`는 관리자에게 BTS·Stray Kids별 수집 진행과 오류를 반환한다. `POST`는 저장된 페이지부터 수집을 시작·재개하며 중복 요청은 실행 임대로 합쳐진다. `PATCH {enabled:boolean}`은 두 그룹의 자동 수집을 켜거나 일시정지한다. 그룹 ID를 임의로 받지 않는다. `GET /api/cron/pocamarket-catalog`는 필수 CRON_SECRET Bearer 인증을 사용한다.

공급처 공개 목록은 `https://pocamarket.com/apis/card/gb/v2/search?group=2|3&sort=new&page=N`이며 그룹 정보는 `/apis/card/gb/v1/group`으로 대조했다. 그룹·필수 필드·다음 페이지가 예상과 다르면 해당 페이지를 반영하지 않고 오류와 재시도 시각을 저장한다. HTTP 차단·요청 제한에 우회하지 않고 1시간 뒤 재시도한다. 다른 그룹 상품, 기존 승인 이미지, 기존 채널 연결과 보유 재고를 덮어쓰지 않는다. 신규 상품의 공급 상태는 미확인, 이미지 작업은 공급 확인 대기 상태로 시작한다. 상품 등록 자체로 eBay·Shopify에 게시하거나 사진을 승인하지 않는다.

2026-09-08 보완: 신상품 수집의 다음 작업을 HTTP로 연쇄 호출하지 않는다. 매분 독립적인 예약 실행이 저장된 페이지부터 한 묶음씩 이어간다. 기존 10분 예약 및 연쇄 호출 방식은 반복 508을 방지하기 위해 교체했다. 일일 새 순환 시작은 한국시간 23시로 유지한다.

2026-09-08: 가격·매물 최신화 생성 API에 선택적 group(BTS 또는 Stray Kids)을 추가했다. 선택 그룹 조건을 DB 후보 조회에 먼저 적용하며, 미지정 시 기존 전체 그룹 동작을 유지한다. 수동 화면에서도 대상 그룹을 선택한다. 진행 중 작업을 이어가는 매분 cron은 resumeOnly=1로 호출하며 새 전체 그룹 작업을 만들지 않는다. HTTP 연쇄 실행을 제거하고 기존 실행 임대·재시도·25초 시작 예산을 유지한다. 묶음 상한은 20개이며 실제 처리량은 시간 예산과 공급처 응답 속도로 제한된다.

### 2026-09-08 멤버와 카드 구분 표시 분리

원본 상품대장의 option_name에는 J-Hope A/B, ID Card Holder Set Jin, M2U LUCKY DRAW Jin A 및 대소문자 혼용이 포함돼 있었다. 재고관리 멤버 필터·초기 옵션·유닛 멤버 선택 목록은 공통 productMember/memberOptions로 정규화한다. 그룹별 멤버 조회를 분리해 BTS 선택 시 Stray Kids 멤버가 섞이지 않는다. 필터는 공백 토큰 경계를 사용해 접두 특전처·접미 A/B를 가진 상품을 포함하고 Jin/Hyunjin 등의 부분 문자열 혼입을 막는다. 원본 optionName과 상품명은 카드/판매채널 옵션 구분에 사용되므로 DB 값을 삭제하거나 병합하지 않으며, 재고관리 멤버 셀에 정규 멤버명과 원본 카드 옵션을 구분해서 표시한다.

`POST /api/pocamarket-purchases/[id]/retry`는 관리자 세션, `confirmedNotPurchased: true`, 조회 응답의 `version`을 요구한다. 실패·가격초과·취소·결제확인대기 요청만 같은 작업 ID로 다시 대기시킨다. 행 잠금과 버전 대조로 중복 확인을 거절하고 구매 완료 수량·허용가격은 유지한다. 같은 카드의 다른 활성 요청, 배송대기가 아닌 주문, 재고 또는 다른 구매로 이미 충족된 부족분은 재시도하지 않는다.


2026-09-14: GET /api/pocamarket-sync/safety는 관리자에게 조달 재확인/보류/실패 수와 최대 20개 사유를 반환한다. POST는 skus 1~10개를 실제 재조회하고 기존 최신화 이력에 기록한다. 외부 판매 수량 반영 완료를 뜻하지 않는다. /api/ebay/operations POST는 선택 productIds(1~500)를 지원한다. 조달 가격·수량 판정은 procurement-freshness, 구매 허용가격은 procurement-price-limit를 공통 사용한다. 정기 조달 변동은 연결된 포카마켓 상품만 대상으로 하며 이미지와 신규등록 큐를 생성하지 않는다.


## 2026-09-14 조달 판매 안전성 추가 계약
- `/api/pocamarket-sync/safety` GET은 최신성 보류/갱신 필요 집계, 관리자 POST는 최대 10개 정확한 상품번호의 포카 재조회를 수행한다. 외부 가격·수량 전송과 구매를 성공으로 대신 표시하지 않는다.
- 관리자 자동 최신화가 켜져 있을 때 활성 조달 상품을 지속 큐로 갱신하고 5분 주기 기존 채널 가격·수량 작업을 예약한다. 원가 재조회 목표 6시간, 24시간 경과 또는 최근 실패 시 조달 수량 제외. 실제 보유 재고는 차감하지 않는다.
- eBay revise Feed 처리 성공 후에도 Inventory 관리 offer의 가격과 원천/offer 수량을 반영한다. 정확한 SKU+listingId+PUBLISHED 연결을 검증하며 다른 상품을 추측 변경하지 않는다. 요청별 결과 코드를 확인하고 진행점을 저장한다. 최근 성공 `EBAY_INVENTORY_REFLECTION` 이력과 보고서를 함께 비교한다. 보고서의 `ebayLastSynced*` 갱신은 Inventory 반영 증거가 아니다.
- `/api/ebay/sales-hold`는 관리자만 사용할 수 있는 최대 3개 상품의 수량 0 정정이다. 현재 중앙 규칙상 판매 가능인 상품은 거부하며 GetItem의 정확한 SKU 판매 가능 0을 확인해야 성공한다. 공유 부모 전체 종료나 가격 변경을 수행하지 않는다.
