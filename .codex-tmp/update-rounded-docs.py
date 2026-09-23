from pathlib import Path
p = Path('docs/business-rules.md')
s = p.read_text(encoding='utf-8').replace('개별 업로드는 1200×1200 캔버스', '개별 업로드는 960×1200 캔버스').replace('음수 패딩과 둥근 모서리 마스크로 원본을 자르지 않는다.', '음수 패딩은 사용하지 않는다. 사용자 요청에 따라 원본 짧은 변의 4.5% 반경으로 모서리를 둥글게 표시한다. 원본 파일은 보존한다. 가로 원본은 세로 방향으로 돌리고 비율을 유지해 공통 배치 상자에 전체 포함한다.')
p.write_text(s, encoding='utf-8')
note = '\n\n2026-09-11 최종 수정: 개별 960×1200·모서리 반경 짧은 변 4.5%를 서버와 화면에 통합했다(v13-portrait-rounded). 묶음은 v10-portrait-rounded-all-cards이며 40장 무음 절단을 제거하고 최대 250장을 명시적으로 검증한다. 48번째 카드까지 포함하는 테스트를 포함해 457개 테스트 통과, lint 오류 0(기존 경고 19), 로컬 및 Vercel 빌드 통과. 배포 dpl_rPnwmWKAXZCp9BfKjLV8U5LMujLG 운영 승격 완료. 아래 이전 시점의 미배포 기록을 대체한다. 기존 판매 갤러리 교체는 사용자 최종 승인 전 중단을 유지한다. 일반 가격·재고 변동은 이미지 교체를 포함하지 않는다.\n'
for file in ['docs/engineering-notes.md', 'docs/tracking/findings.md']:
 p = Path(file)
 s = p.read_text(encoding='utf-8')
 at = s.find('\n')
 s = s[:at] + note + s[at:]
 if file.endswith('engineering-notes.md'):
  s = s.replace('라운드 마스크와 음수 패딩은 카드 가장자리를 제거할 수 있어 사용하지 않는다.', '당시에는 라운드 마스크를 제거했으나 최종 사용자 요청으로 4.5% 모서리 처리를 복원했다. 음수 패딩은 계속 금지한다.')
 p.write_text(s, encoding='utf-8')
p = Path('outputs/image-review-2026-09-11/REVIEW.md')
p.write_text('# 둥근 모서리 비교안 v4 — 판매 반영 승인 대기\n\n실제 운영 렌더러와 동일한 코드로 960×1200 출력, 비율 유지, 세로 배치, 둥근 모서리를 생성했다. 개별 6개와 WINGS 6장 묶음을 시각 확인했다. 15131·12764의 높이는 동일하며 폭은 원본 비율대로 유지한다. 원본 안의 여백은 제거하지 않는다. 매우 넓거나 회전한 이미지는 안전 영역에 전체 포함하므로 높이가 작아질 수 있다.\n\n프로그램 배포는 완료했으나 기존 eBay·Shopify 갤러리 교체는 재개하지 않았다. 일반 가격·재고 변동은 이미지 교체와 별도이다. 457개 테스트, lint 오류 0, 빌드 통과. 48장 묶음의 마지막 카드 포함도 테스트했다.\n', encoding='utf-8')
p = Path('.codex-tmp/image-review-template.html')
s = p.read_text(encoding='utf-8').replace('사진을 자르거나 늘리지 않았습니다.', '사진 비율을 유지하고 카드 모서리를 둥글게 복원했습니다.')
p.write_text(s, encoding='utf-8')
