# GNW — Game New Watch 🎮

PC · 콘솔 · 모바일 **신작 출시 · 사전예약 · CBT/OBT · 대규모 업데이트 일정**을
한눈에 보는 웹앱. 하나의 `data/games.json` 데이터를 **웹앱**과 **아이폰 위젯**이
함께 사용하도록 설계되어, 어디서 보든 정보가 어긋나지 않습니다.

정보 구성은 **네이버 게임 · 인벤 · 디스이즈게임 · TapTap · 루리웹** 의 일정/뉴스/DB를
참조하여 재구성했습니다.

![icon](icons/icon-192.png)

---

## ✨ 주요 기능

- **월별 타임라인** — 일정을 달력처럼 월 단위로 묶어 보고, **이번 달** 일정을 강조 (그리드 보기도 토글 가능)
- **일정 종류별 분류** — `출시` · `사전예약` · `CBT` · `OBT` · `대규모 업데이트` 를 색상 배지로 구분 및 필터
- **한글 제목 + 번역** — 한글 게임명과 주요 업데이트/내용을 함께 표기 (원제·개발사 병기)
- **모바일 신작 특화** — 국내 대형 퍼블리셔(넥슨·넷마블·엔씨 등) + 서브컬처/글로벌 모바일 신작 + CBT/OBT 테스트 일정 포함
- **출처 표기** — 각 항목마다 참조 커뮤니티(네이버 게임/인벤/디스이즈게임/TapTap) 링크
- **강력한 정렬·필터** — 일정/기대지수/평점/가격/제목 정렬 + 일정종류·기간·플랫폼·장르 다중 필터 + 통합 검색
- **자동 최신화** — 앱 진입/복귀 시 전체 정보 자동 재요청, `⟳` 수동 새로고침 + 마지막 갱신 시각
- **소개 영상 링크** — 카드의 ▶ 버튼으로 트레일러 바로 보기 (위젯 탭에서도 열림)
- **모바일 최적화 + PWA** — 모바일 우선 레이아웃, 홈 화면 추가, 오프라인 캐싱(서비스 워커)
- **iOS 위젯** — Scriptable 위젯으로 홈 화면에서 다음 일정 확인 (Small/Medium/Large)

> 참조 사이트: [네이버 게임](https://game.naver.com/) · [인벤](https://www.inven.co.kr/) · [디스이즈게임](https://www.thisisgame.com/) · [TapTap](https://www.taptap.io/) · [루리웹](https://m.ruliweb.com/news)

---

## 📁 구조

```
GNW/
├── index.html              # 웹앱 진입점
├── styles.css              # 다크 테마 UI
├── app.js                  # 필터/정렬/렌더 로직 (빌드 불필요, Vanilla JS)
├── manifest.webmanifest    # PWA 매니페스트
├── sw.js                   # 서비스 워커 (오프라인 캐싱)
├── data/
│   └── games.json          # ⭐ 단일 데이터 소스 (웹앱 + 위젯 공용)
├── icons/                  # 앱 아이콘 (svg + png)
└── widget/
    └── gnw-widget.js        # iOS Scriptable 위젯 스크립트
```

---

## 🚀 실행 (웹앱)

빌드 도구가 필요 없습니다. 정적 파일 서버만 있으면 됩니다.

```bash
# 아무 정적 서버나 사용 가능
python3 -m http.server 8080
# 또는
npx serve .
```

브라우저에서 `http://localhost:8080` 접속.

> `fetch`로 `data/games.json`을 읽기 때문에 `file://` 직접 열기가 아닌
> **HTTP 서버**로 열어야 합니다.

### 배포 (GitHub Pages 권장)

이 저장소를 GitHub Pages로 게시하면 그대로 동작합니다.
게시 후 데이터 URL은 다음과 같습니다:

```
https://<user>.github.io/<repo>/data/games.json
```

---

## 📱 아이폰 위젯 포팅

웹앱과 **같은 `games.json`** 을 사용하므로 데이터 관리가 이원화되지 않습니다.

1. App Store에서 **Scriptable** (무료) 설치
2. 이 저장소를 호스팅(예: GitHub Pages)하고 `data/games.json`의 URL 확보
3. Scriptable에서 새 스크립트 생성 → `widget/gnw-widget.js` 내용 붙여넣기
4. 파일 상단의 `DATA_URL` 을 본인 호스팅 URL로 교체
5. 홈 화면에 Scriptable 위젯 추가 → 길게 눌러 **Edit Widget** → 이 스크립트 선택
   - **Small**: 가장 임박한 출시작 1개를 큰 D-day로
   - **Medium**: 다음 출시작 3개
   - **Large**: 다음 출시작 6개

오프라인이거나 네트워크 오류 시에는 안내 문구를 표시합니다.

---

## 🗂 데이터 추가/수정

`data/games.json` 의 `games` 배열에 항목을 추가하면 웹앱과 위젯에 즉시 반영됩니다.

```jsonc
{
  "id": "고유-id",
  "title": "Game Title",                   // 원제
  "titleKr": "게임 제목",                   // 한글 제목 (카드 메인 표기)
  "developer": "개발사",
  "publisher": "퍼블리셔",
  "platforms": ["Mobile", "PC", "PS5"],    // 필터/배지에 사용
  "genres": ["MMORPG", "수집형"],          // 필터/배지에 사용
  "releaseDate": "2026-11-19",            // YYYY-MM-DD (타임라인 월 그룹/정렬/D-day)
  "eventType": "release",                  // release | prereg | cbt | obt | update
  "status": "upcoming",                    // "upcoming" | "released" (기간 필터)
  "price": 69900,                          // 원화, 0 이면 무료(F2P)
  "hypeScore": 99,                         // 기대지수 0~100 (정렬)
  "rating": null,                          // 평점 0~10, 미정은 null
  "tags": ["국산", "사전예약"],             // 검색 대상
  "description": "한 줄 소개",
  "update": "정식 출시. 신규 직업 5종 추가.",// 주요 업데이트/내용 (📌 강조 표기)
  "color": "#7b5cff",                      // 카드 배너/위젯 점 색상
  "source": { "name": "네이버 게임", "url": "https://game.naver.com/" }, // 출처
  "trailer": "https://youtu.be/..."        // 소개 영상 링크 (카드 ▶ / 위젯 탭)
}
```

**eventType 종류**: `release`(출시) · `prereg`(사전예약) · `cbt`(CBT) · `obt`(OBT) · `update`(대규모 업데이트)

---

## 🛠 기술 메모

- **의존성 0** — 프레임워크·번들러 없이 순수 HTML/CSS/JS. 유지보수와 위젯 포팅이 쉽도록 의도.
- **단일 데이터 소스** — 웹앱과 iOS 위젯이 동일 JSON을 소비해 정보 불일치 방지.
- 서비스 워커는 앱 셸을 캐시하고, `games.json`은 **network-first**로 최신 데이터를 우선합니다.

> 샘플 데이터의 출시일/평점은 데모용이며 실제와 다를 수 있습니다.
