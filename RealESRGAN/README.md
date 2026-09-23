# 로컬 포토카드 화질 개선기

Windows 10 + NVIDIA CUDA에서만 동작하는 독립형 Real-ESRGAN 테스트 프로그램입니다. 이미지 자체는 외부 서버로 전송하지 않습니다. 처음 실행 때 공식 GitHub에서 **모델 가중치 파일만** 내려받으며, 이후 모든 처리는 로컬 GPU에서 수행됩니다.

얼굴 복원(GFPGAN 등) 기능은 포함하지 않았습니다. 따라서 얼굴, 눈, 코, 입을 생성적으로 바꾸지 않고 Real-ESRGAN 업스케일·압축 흔적 완화만 수행합니다.

## 구조

```text
RealESRGAN/
├── app.py                    # Tkinter 테스트 GUI
├── generate_comparison.py    # A/B/C 샘플 비교 생성
├── enhancer/engine.py        # 웹 백엔드에서도 재사용할 독립 엔진
├── models/                   # .pth 모델 파일 (Git 제외)
├── input/                    # 선택적 로컬 입력 폴더
├── output/                   # 결과만 저장, 원본은 절대 수정하지 않음
├── logs/enhancer.log         # 오류·처리 로그
├── test_images/              # 제공된 포토카드 샘플
├── install.bat
├── run.bat
└── compare_sample.bat
```

## 설치

1. NVIDIA 드라이버를 최신 상태로 업데이트합니다.
2. **Python 3.10 또는 3.11 (64-bit)** 을 설치하고 설치 화면에서 `Add Python to PATH`를 선택합니다. 현재 PC에 있는 Python 3.13은 Real-ESRGAN 의존성과의 호환성을 보장하지 않으므로 사용하지 않습니다.
3. `install.bat`을 더블클릭합니다. 프로젝트 전용 `.venv`와 CUDA PyTorch 및 필요한 패키지를 설치합니다.
4. 완료 후 `run.bat`을 더블클릭합니다.

`install.bat`은 Real-ESRGAN과 검증된 CUDA 12.1 PyTorch 조합을 사용합니다. RTX 3060 Ti에서는 NVIDIA 드라이버가 충분히 최신이면 CUDA Toolkit을 별도로 설치할 필요가 없습니다.

## GUI 사용

`이미지 선택` 또는 `폴더 선택` → 모델과 배율 선택 → `실행` 순서입니다.

- 단일 파일: 원본과 결과가 좌우로 표시됩니다.
- 폴더: PNG/JPG/JPEG/WebP만 처리하고 진행 수 `완료: n / 전체`를 표시합니다.
- 출력: 항상 `output/<입력폴더명>/`에 새 파일로 저장합니다. 원본 파일은 수정·이동·삭제하지 않습니다.
- 큰 이미지에서 VRAM 부족 오류가 나면 엔진이 자동으로 tile 256으로 한 번 재시도합니다. 그래도 실패하면 로그에 이유를 남기고 종료 대신 오류를 표시합니다.

## 기본 및 추천 설정

기본값은 `RealESRGAN_x2plus`, **2배**, **AI 보정 55%**입니다. AI 결과와 Lanczos 방식으로 키운 원본을 섞기 때문에, 별도 샤픈을 더하지 않고도 얼굴·피부 질감을 더 보수적으로 보존합니다.

- 30~45%: 매우 자연스럽게. 얼굴이 달라질 우려를 가장 낮춘 판매용 시작점
- 55%: 기본값. 흐림·JPEG 흔적과 눈가/머리카락 경계를 균형 있게 개선
- 70% 이상: AI 질감이 더 뚜렷함. 원본과 100% 확대 비교가 필요한 수준
- 100%: 순수 Real-ESRGAN 출력. A/B/C 모델 비교용이며, 일반 판매용 기본값으로는 권장하지 않음

`RealESRGAN_x4plus`는 더 큰 출력이 꼭 필요할 때만 비교용으로 사용하세요. 과한 4배 확대는 원본에 없던 질감을 더 눈에 띄게 만들 수 있으므로 판매 등록 전에는 반드시 원본과 100% 확대 비교를 권합니다.

`4x-UltraSharp`는 호환되는 `4x-UltraSharp.pth`를 `models/`에 직접 넣은 경우에만 선택할 수 있습니다. 가중치 출처와 라이선스를 확인한 뒤 사용하세요. 이 프로그램은 해당 파일을 자동 다운로드하지 않습니다.

## A/B/C 자동 비교

설치 후 `compare_sample.bat`을 실행하면 `test_images/1.jpg`를 기준으로 아래 3개 파일을 자동 생성합니다.

- A: 원본 복사본
- B: `RealESRGAN_x2plus` 2배
- C: `RealESRGAN_x4plus` 4배

결과는 `output/comparisons/1/`에 저장되고, `comparison.json`에는 각 결과의 처리 시간과 출력 해상도가 기록됩니다. 다른 샘플은 다음처럼 실행합니다.

```bat
.venv\Scripts\python.exe generate_comparison.py test_images\2.jpg
```

## GPU 확인

다음 명령을 실행해 `True`와 RTX 3060 Ti 이름이 나오는지 확인합니다.

```bat
.venv\Scripts\python.exe -c "import torch; print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0))"
```

GUI 상단 상태도 CUDA 사용 가능 여부와 VRAM을 표시합니다. `False`이면 NVIDIA 드라이버를 업데이트하고 `install.bat`을 다시 실행하세요. CPU용 PyTorch가 설치된 상태에서는 의도적으로 처리를 시작하지 않습니다.

## 웹사이트 통합 준비

GUI는 `enhancer.engine`만 호출합니다. 추후 백엔드에서는 GUI 없이 아래 함수만 사용하면 됩니다.

```python
from enhancer.engine import enhance_image

result = enhance_image(
    input_path="local/original.jpg",
    output_path="local/output.jpg",
    model_name="RealESRGAN_x2plus",
    scale=2,
    settings={"tile": 0, "jpeg_quality": 95},
)
```

통합 시에도 워터마크 제거가 끝난 **새 로컬 파일**을 입력으로 전달하고, `result.output_path`를 사람 검수 단계에 올리세요. 판매 이미지 반영은 자동화하지 않았습니다.

### 현재 주문관리자 연결

주문관리자 배포본에서는 워터마크 제거 뒤 이 PC가 보정 작업을 가져갑니다. `site_worker.env.example`을 복사해 **`site_worker.env`**로 이름을 바꾸고 운영 URL과 `LOCAL_AI_WORKER_TOKEN`을 입력한 뒤 `run_site_worker.bat`을 실행하세요. 이 파일은 Git에 포함되지 않습니다.

작업자는 보관된 제거본을 내려받아 로컬 RTX GPU에서만 보정하고 결과 JPEG만 주문관리자로 돌려보냅니다. 개선 실패 시 제거본은 삭제되지 않으며, 관리자 화면의 `화질 개선만 다시 시도`는 외부 워터마크 제거 API와 크레딧을 다시 쓰지 않습니다. 최종 검수 통과 뒤에만 제거 중간본이 자동 정리됩니다.

## 문제 해결

- `CUDA GPU를 찾지 못했습니다`: Python 3.10/3.11로 `install.bat`을 다시 실행하고 NVIDIA 드라이버를 확인합니다.
- 모델 다운로드 실패: 인터넷 연결을 확인한 뒤 다시 실행하거나, 공식 `.pth` 파일을 `models/`에 수동으로 넣습니다.
- VRAM 부족: 다른 GPU 프로그램을 닫고 다시 시도하세요. 큰 이미지는 자동 tile 재시도를 하며, 필요하면 호출 시 `settings={"tile": 256}`을 지정할 수 있습니다.
- 처리 오류: `logs/enhancer.log`의 마지막 줄과 입력 파일을 확인합니다. 지원 형식은 PNG/JPG/JPEG/WebP입니다.
- 색상/방향 문제: 엔진은 EXIF 회전을 적용하고 RGB로 정규화합니다. 원본은 바꾸지 않습니다.
