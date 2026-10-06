# 소준희 포트폴리오

Flask 기반 개인 포트폴리오 사이트입니다. 프로필/경력/프로젝트 데이터는 `data/*.json`으로 관리하며, 파일을 수정하면 다음 요청부터 바로 반영됩니다(코드 변경·재배포 불필요).

## 요구 사항

- Python 3.10+
- (선택) 로컬 브라우저 검증을 위해 Playwright

## 설치

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt

# 개발/테스트 도구(Playwright 포함)까지 설치하려면
pip install -r requirements-dev.txt
playwright install
```

## 실행

```powershell
# 개발 서버 (기본 포트 5000, PORT 환경변수로 변경 가능)
python app.py

# 운영 배포 (waitress)
waitress-serve --host=127.0.0.1 --port=5000 app:app
```

브라우저에서 http://127.0.0.1:5000 접속.

## 데이터 편집

| 파일 | 내용 |
| --- | --- |
| `data/profile.json` | 이름, 연락처, 핵심 지표, 역량, 스킬 |
| `data/experiences.json` | 경력 타임라인 (회사/기간/역할/성과) |
| `data/projects.json` | 프로젝트 목록 (`is_published: true`인 항목만 노출) |

세 파일 모두 UTF-8로 저장하세요(BOM 유무는 무관 — 서버가 `utf-8-sig`로 읽어 자동 처리합니다). 파일이 없거나 JSON 형식이 깨진 경우 서버는 죽지 않고 안전한 기본값으로 대체하며, 로그에 경고(`Could not load portfolio data: ...`)를 남깁니다.

프로젝트 이미지는 `static/images/projects/` 안에만 두고, `projects.json`의 `thumbnail`/`gallery.src`에는 `images/projects/파일명.png`처럼 그 폴더를 기준으로 한 상대 경로를 적어야 노출됩니다(경로 탈출·원격 URL은 자동으로 무시됩니다).

`projects.json`에는 화면 표시용 선택 필드를 둘 수 있습니다(없어도 정상 표시). `card_label`(카드의 팀/개인 구분, 없으면 `program`), `card_summary`(카드 요약, 없으면 `description`), `card_role`(카드·상세 헤더의 한 줄 역할, 없으면 80자 이하인 `role`), `my_contribution` / `team_contribution`(상세의 "내 기여와 팀의 역할" 목록, 없으면 `role` 원문 표시). 홈 Hero의 대표 작업은 `sort_order`가 가장 앞선 공개 프로젝트입니다.

## 테스트

```powershell
# 단위 테스트 (라우팅, XSS/경로 방어, 스키마 검증 등)
python -m unittest discover -s tests -v

# 브라우저 반응형/접근성 점검 (Desktop/Tablet/Mobile, Playwright 필요)
python tests/browser_check.py
```

`browser_check.py`는 로컬 5057 포트에 앱을 띄워 8종 뷰포트(1920~360px)에서 홈과 공개 프로젝트 상세를 스크린샷(`test-results/`)으로 저장하고, 가로 넘침·모바일 메뉴(767px 이하) 키보드 동작·앵커 위치·이메일 복사·reduced-motion/JavaScript 미실행 시 본문 노출·프로젝트 0~3개 레이아웃(임시 데이터)·404·레거시 경로를 자동 검증합니다.

## 프로젝트 구조

```
app.py                  # 라우팅 및 데이터 로딩/검증 로직
data/                   # profile.json / experiences.json / projects.json
templates/              # Jinja 템플릿 (base.html이 공통 레이아웃)
templates/partials/     # 카드·링크 등 재사용 조각
static/                 # CSS, JS, 이미지
tests/                  # unittest(test_app.py), Playwright 점검(browser_check.py)
```
