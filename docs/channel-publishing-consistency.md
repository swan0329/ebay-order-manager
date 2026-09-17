# 판매채널 데이터 일관성

## 원칙

상품 원본과 채널 파생물을 구분한다. 상품명·상세설명·가격·판매수량·등록 이미지는 각각 한 모듈만 최종 결정을 내리며, eBay API·eBay 엑셀·Shopify 단품·옵션상품은 그 결과를 소비만 한다.

| 항목 | 중앙 결정 경로 | 소비 경로 |
| --- | --- | --- |
| 제목·상세·상품특성 | `src/lib/ebay-listing-fields.ts` | eBay API·엑셀, Shopify 단품·옵션 |
| 판매가 | `src/lib/listing-price.ts` | eBay API·엑셀, Shopify 단품·옵션·가격 반영 |
| 판매수량 | `src/lib/listing-quantity.ts` | eBay API·엑셀, Shopify 단품·옵션·재고 반영 |
| 단품 등록 이미지 | Shopify에 실제 게시된 미디어, 없으면 상품의 기존 갤러리 | eBay API·Shopify |
| 옵션 썸네일 워터마크 설정 | `variation_thumbnail_settings`와 `src/lib/variation-thumbnail-settings.ts` | 옵션상품 대표 썸네일 |

## 이미지 데이터 규칙

1. 기존 Shopify 단품 업로더는 워터마크를 합성하지 않는다. 상품에 저장된 이미지를 그대로 게시한다.
2. Shopify에 이미 연결된 상품을 eBay에 등록할 때는 Shopify GraphQL에서 현재 게시 미디어 URL을 읽어 그대로 사용한다.
3. Shopify에 아직 없는 상품은 Shopify 업로더와 동일하게 `ebayImageUrls`, `imageUrl` 순서의 저장 이미지를 사용한다.
4. eBay 등록 과정에서 임의 크기의 워터마크를 다시 합성하거나 승인 원본을 다른 경로로 재선택하지 않는다.
5. 옵션상품 대표 썸네일은 별도 합성 이미지이므로 로고·투명도·크기·간격을 사용자별로 저장한다.

## 등록 전 확인

단품 등록 전 미리보기는 새 워터마크를 만들어 보여주는 방식이 아니라 Shopify의 현재 게시 미디어 또는 동일한 저장 이미지 URL을 보여줘야 한다. 외부 게시와 다른 합성 미리보기는 근거로 사용하지 않는다.

## 확인한 기존 불일치와 조치

- 옵션 썸네일 화면은 로고만 저장하고 크기·간격·투명도를 버렸다. 세 값은 옵션 썸네일 설정으로 DB에 저장한다.
- Shopify가 정상적으로 쓰던 이미지를 새 워터마크 엔진의 결과로 잘못 교체한 변경은 제거했다.
- eBay 단품·옵션 API는 연결된 Shopify 상품의 실제 게시 미디어 URL을 우선 사용한다.
- Shopify 단품과 가격 반영은 저장 가격을 직접 사용하고 옵션상품만 중앙 가격 계산을 썼다. 모두 `resolveListingPriceUsd`를 사용하도록 변경했다.
- eBay 엑셀은 기존 검증된 이미지 필드 조립 방식을 유지한다.
- Shopify 옵션 설명은 단품 설명 조립 경로를 건너뛰었다. 같은 설명 조립 경로를 사용하도록 변경했다.

## 남은 구조 정리

`Product.ebayImageUrls` 이름은 실제로 여러 채널에서 사용된 과거가 있어 의미가 모호하다. 운영 데이터 보존 마이그레이션을 준비해 승인 원본 목록과 채널별 파생물 기록을 별도 구조로 분리해야 한다. 또한 `source_image_url`, `user_front_image_url`, `user_back_image_url`, `featured_members`는 Prisma 모델 밖의 원시 열 접근을 없애고 정식 스키마로 통합해야 한다.
