#!/usr/bin/env node
/* GNW data ingestion pipeline
 * ---------------------------------------------------------------------------
 * 손으로 채우던 정적 샘플의 한계를 넘기 위한 자동 수집기.
 * 여러 공개 소스에서 출시/업데이트 정보를 모아 GNW 스키마로 정규화하고,
 * 사람이 관리하는 data/curated.json(한글 제목·CBT/OBT 등)과 병합해
 * data/games.json 을 생성한다.
 *
 *   node scripts/build-data.mjs
 *
 * 환경변수(없으면 해당 소스는 건너뜀 → 큐레이션만으로도 동작):
 *   RAWG_API_KEY   RAWG 게임 DB (출시일/플랫폼/평점) — https://rawg.io/apidocs
 *   STEAM          "1" 이면 Steam 출시예정 카테고리 수집
 *   RSS            "1" 이면 국내 게임 매체 RSS(루리웹/디스이즈게임/인벤) 수집
 *
 * 병합 규칙: 같은 게임이면 curated 가 자동 수집본을 덮어쓴다(번역/현지 정보 우선).
 * --------------------------------------------------------------------------- */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// 로컬 편의: 루트의 .env (gitignore 처리됨) 에서 KEY=VALUE 를 읽어 환경변수로 주입.
// 키를 소스코드/명령행에 노출하지 않고 실행하기 위함. (이미 설정된 env 는 덮어쓰지 않음)
function loadEnv() {
  const f = join(ROOT, ".env");
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const TODAY = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const WINDOW_FROM = new Date(TODAY.getTime() - 90 * 864e5);  // 최근 3개월
const WINDOW_TO = new Date(TODAY.getTime() + 365 * 864e5);   // 향후 1년

const PALETTE = ["#e84d8a","#3aa757","#d98324","#b14aed","#4a90d9","#f0c419","#5b8def","#c9a227","#16a085","#00a8cc","#9b59b6","#e67e22","#2980b9","#8e44ad","#27ae60","#ff4655","#7b5cff","#00c2cb"];
const colorFor = (s) => PALETTE[[...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length];

const PLATFORM_MAP = {
  "PC": "PC", "macOS": "PC", "Linux": "PC",
  "PlayStation 5": "PS5", "PlayStation 4": "PS5",
  "Xbox Series S/X": "Xbox Series", "Xbox One": "Xbox Series",
  "Nintendo Switch": "Switch", "iOS": "Mobile", "Android": "Mobile",
};
const GENRE_MAP = {
  Action: "액션", RPG: "RPG", Shooter: "슈팅", Adventure: "어드벤처",
  Strategy: "전략", Simulation: "시뮬레이션", Sports: "스포츠", Puzzle: "퍼즐",
  Indie: "인디", "Massively Multiplayer": "MMORPG", Fighting: "대전",
  Racing: "레이싱", Platformer: "플랫포머", Casual: "캐주얼", Family: "캐주얼",
  Card: "수집형", Board: "전략", Educational: "캐주얼", Arcade: "액션",
};

const normTitle = (t) => t.toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
const slug = (t) => normTitle(t).replace(/[^a-z0-9]/g, "-").slice(0, 40) || "game";
const trailerFor = (t, dev) =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(`${t} ${dev || ""} official trailer`)}`;

function makeGame(p) {
  const date = p.releaseDate;
  return {
    id: p.id || slug(p.title),
    title: p.title,
    titleKr: p.titleKr || p.title,
    developer: p.developer || "미상",
    publisher: p.publisher || p.developer || "미상",
    platforms: [...new Set((p.platforms || []).filter(Boolean))],
    genres: [...new Set((p.genres || []).filter(Boolean))],
    releaseDate: date,
    eventType: p.eventType || "release",
    status: (date && date !== "TBD" && new Date(date) < TODAY) ? "released" : "upcoming",
    price: p.price ?? null,
    hypeScore: p.hypeScore ?? null,
    rating: p.rating ?? null,
    tags: p.tags || [],
    description: p.description || "",
    update: p.update || "",
    color: p.color || colorFor(p.title),
    image: p.image || null,           // 카드 썸네일(인벤 CDN 이미지 URL 등), 없으면 그라데이션 폴백
    source: p.source,
    detailUrl: p.detailUrl || detailFor(p.titleKr || p.title),   // 상세설명 링크(본 제목 검색)
    trailer: p.trailer || trailerFor(p.title, p.developer),
  };
}

const INVEN_CAL = { name: "인벤 발매 캘린더", url: "https://www.inven.co.kr/webzine/calendar/" };
const RULIWEB_NEWS = { name: "루리웹", url: "https://m.ruliweb.com/news" };

// 브라우저 유사 헤더(봇 차단 완화) — 러너에서만 외부 접근 가능
const HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "ko-KR,ko;q=0.9",
  "referer": "https://m.ruliweb.com/",
};

// 검색용 핵심 게임명 추출: 부제·버전·괄호·콜론 등을 떼어 깔끔한 본 제목만 남긴다.
// (긴 부제/특수문자가 들어간 인벤 검색 URL 이 404 나는 문제를 방지)
function baseGameName(t) {
  let s = String(t);
  s = s.split(/\s[-–—~]\s/)[0];                          // " - " 이후 부제 제거
  s = s.replace(/[「」『』《》〈〉【】［］\[\]()<>]/g, " "); // 괄호류 제거
  s = s.replace(/['"''""]/g, " ");    // 따옴표 제거
  s = s.replace(/\d+(\.\d+)*\s*(버전|시즌|주년|챕터)/g, " "); // "4.3버전" 등 제거
  s = s.replace(/시즌\s*\d+/g, " ");                       // "시즌 5" 제거
  s = s.replace(/\b\d+\.\d+\b/g, " ");                     // 소수 버전(1.1, 4.3) 제거 — 정수("007","8020")는 보존
  s = s.replace(/업데이트|패치/g, " ");                     // 업데이트/패치 표기 제거
  s = s.replace(/[:：]/g, " ");                            // 콜론 제거
  s = s.replace(/\s+/g, " ").trim();
  return s || String(t);
}
// 인벤 웹진 통합검색(기사) — 본 제목으로만 검색해 안정적으로 결과 페이지로 이동.
const detailFor = (t) =>
  `https://www.inven.co.kr/search/webzine/article/${encodeURIComponent(baseGameName(t))}/1?sort=recency`;

/* ---------- Providers ---------- */
async function fromRAWG(out) {
  const key = process.env.RAWG_API_KEY;
  if (!key) return { name: "RAWG", skipped: "RAWG_API_KEY 없음" };
  const maxPages = Number(process.env.RAWG_PAGES || 8); // 페이지당 40개 → 기본 320개
  let url = `https://api.rawg.io/api/games?key=${key}&dates=${iso(WINDOW_FROM)},${iso(WINDOW_TO)}&ordering=-added&page_size=40`;
  let added = 0, pages = 0;
  while (url && pages < maxPages) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`RAWG HTTP ${res.status}`);
    const data = await res.json();
    for (const g of data.results || []) {
      if (!g.released) continue;
      out.push(makeGame({
        id: `rawg-${g.id}`,
        title: g.name,
        platforms: (g.platforms || []).map((x) => PLATFORM_MAP[x.platform?.name]).filter(Boolean),
        genres: (g.genres || []).map((x) => GENRE_MAP[x.name] || x.name),
        releaseDate: g.released,
        rating: g.metacritic ? +(g.metacritic / 10).toFixed(1) : (g.rating ? +(g.rating * 2).toFixed(1) : null),
        hypeScore: g.added ? Math.min(99, Math.round(Math.log10(g.added + 1) * 25)) : null,
        tags: (g.tags || []).slice(0, 3).map((t) => t.name),
        description: "",
        source: { name: "RAWG", url: `https://rawg.io/games/${g.slug}` },
      }));
      added++;
    }
    url = data.next;
    pages++;
  }
  return { name: "RAWG", added };
}

// 인벤 발매 캘린더(주요 일정) 파서. HTML 구조 의존이라 best-effort 이며,
// 실제 페이지 마크업에 맞춰 SEL/정규식 조정이 필요할 수 있다. INVEN=1 일 때만 동작.
async function invenFetch(url) {
  try { const res = await fetch(url, { headers: HEADERS }); return { html: await res.text(), status: res.status, err: "" }; }
  catch (e) { return { html: "", status: 0, err: String(e && e.message || e) }; }
}
// HTML 에 들어있는 일정들의 YYYYMM 집합(월 파라미터 탐지용)
function invenMonths(html) {
  const s = new Set();
  for (const m of html.matchAll(/dates=(\d{8})/g)) s.add(m[1].slice(0, 6));
  return s;
}
// 한 달 분량 HTML 에서 일정 항목 파싱 → out 에 추가. seen 으로 월/소스 간 중복 제거.
// tbd=true: 날짜 없는 항목도 releaseDate="TBD" 로 수집 (미정 페이지용).
function parseInvenCalendar(html, out, seen, tbd = false) {
  const abs = (u) => !u ? null : (u.startsWith("/") ? "https://www.inven.co.kr" + u : u);
  const stripTags = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  // 인벤 분류 텍스트 → GNW eventType
  const evMap = (s) => {
    s = String(s || "");
    if (/얼리\s*액세스/.test(s)) return "ea";
    if (/테스트|CBT|OBT|베타/i.test(s)) return "test";
    if (/업데이트|패치|시즌/.test(s)) return "update";
    if (/행사|쇼케이스|페스트|페스티벌|컨퍼런스|콘퍼런스|팝업|대회|기념|발표/.test(s)) return "event";
    return "release"; // 출시·사전예약 등
  };
  const PLAT = { pc: "PC", ps5: "PS5", ps4: "PS5", xbox: "Xbox Series", xboxseries: "Xbox Series", switch: "Switch", switch2: "Switch 2", ns: "Switch", mobile: "Mobile", ios: "Mobile", aos: "Mobile", android: "Mobile" };

  let added = 0;
  for (const m of html.matchAll(/<li class="calendar__item[\s\S]*?<\/li>/g)) {
    const it = m[0];

    // 제목 (행사형은 .title-text, 출시형은 .calendar__title 직접)
    let title = (it.match(/class="title-text">[\s\S]*?<\/span>/) || [])[1];
    if (!title) title = (it.match(/class="calendar__title"[^>]*>[\s\S]*?<\/h3>/) || [])[1];
    title = stripTags(title);
    if (!title || title.length < 2) continue;

    // 날짜: 구글캘린더 dates=YYYYMMDD 우선, 없으면 MM/DD(요일)+연도 추정
    let date = null;
    const gd = it.match(/dates=(\d{8})/);
    if (gd) date = `${gd[1].slice(0, 4)}-${gd[1].slice(4, 6)}-${gd[1].slice(6, 8)}`;
    else {
      const md = it.match(/calendar__day-num'?[^>]*>\s*(\d{1,2})\/(\d{1,2})/);
      if (md) { let y = TODAY.getFullYear(); if (+md[1] < TODAY.getMonth() + 1 - 6) y++; date = `${y}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}`; }
    }
    if (!date) {
      if (!tbd) continue;
      date = "TBD";
    }

    const sort = (it.match(/calendar__event-sort">([^<]+)/) || it.match(/calendar__platform-txt">([^<]+)/) || [])[1];
    const eventType = evMap(sort);
    const image = (it.match(/calendar__figure[\s\S]*?<img[^>]+src="([^"]+)"/) || [])[1] || null;
    // 직접 상세 링크: group 앵커 href (출시작은 /webzine/calendar/game/{id}, 행사는 뉴스/공식/영상)
    const atag = (it.match(/<a\b[^>]*calendar__item--group[^>]*>/) || [])[0] || "";
    const detailUrl = abs((atag.match(/href="([^"]+)"/) || [])[1]);
    const idx = (it.match(/data-game-idx="(\d+)"/) || [])[1] || (detailUrl && (detailUrl.match(/\/game\/(\d+)/) || [])[1]);
    const yt = (it.match(/data-youtube="([^"]+)"/) || [])[1];
    const company = stripTags((it.match(/class="calendar__company">[\s\S]*?<\/(?:p|span)>/) || [])[1]);
    const platforms = [...new Set([...it.matchAll(/calendar__platform-icon--([a-z0-9]+)/g)].map((x) => PLAT[x[1]]).filter(Boolean))];
    const tags = [...it.matchAll(/class="calendar__event-tag">\s*([^<]+?)\s*<\/span>/g)].map((x) => x[1].trim()).filter(Boolean);

    // 같은 일정이 여러 달 HTML 에 겹쳐 나올 수 있으므로 id+날짜로 중복 제거.
    // TBD 항목은 날짜 확정 버전이 이미 있으면 스킵(날짜 확정 시 월별 스케줄로 자동 이동).
    const id = idx ? `inven-${idx}` : `inven-${slug(title)}`;
    const dedupKey = `${id}@${date}`;
    if (seen.has(dedupKey)) continue;
    if (date === "TBD" && seen.has(`${id}@dated`)) continue;
    seen.add(dedupKey);
    if (date !== "TBD") seen.add(`${id}@dated`);

    // company: 출시형은 원제(영문), 행사형은 설명문 → 분배
    const isDesc = /[.!?。…]$|습니다|됩니다|진행|예정|공개|출시|개최|등장/.test(company);
    out.push(makeGame({
      id,
      title: (!isDesc && company && /[A-Za-z]/.test(company)) ? company : title,
      titleKr: title,
      platforms, genres: [],
      releaseDate: date,
      eventType,
      tags: tags.length ? tags : ["인벤"],
      description: isDesc ? company : "",
      image,
      source: INVEN_CAL,
      detailUrl: detailUrl || null,            // 인벤이 가리키는 직접 상세/공식 페이지
      trailer: yt ? `https://youtu.be/${yt}` : undefined,
    }));
    added++;
  }
  return added;
}

async function fromInven(out) {
  if (process.env.INVEN !== "1") return { name: "Inven", skipped: "INVEN!=1" };

  // 기준(현재 월) 페이지: 로컬 픽스처 우선, 없으면 실제 캘린더.
  let base;
  if (process.env.INVEN_HTML_FILE) {
    try { base = { html: readFileSync(process.env.INVEN_HTML_FILE, "utf8"), status: 200, err: "" }; }
    catch (e) { base = { html: "", status: 0, err: String(e && e.message || e) }; }
  } else {
    base = await invenFetch(INVEN_CAL.url);
  }

  // 진단 파일: 러너가 인벤으로부터 실제로 받은 것을 저장소에 남겨 구조/도달성 확인.
  try {
    const dbg = [
      `fetched_at=${new Date().toISOString()}`,
      `url=${INVEN_CAL.url}`,
      `status=${base.status}`,
      `error=${base.err}`,
      `html_length=${base.html.length}`,
      `calendar_game_links=${(base.html.match(/\/webzine\/calendar\/game\/\d+/g) || []).length}`,
      `news_links=${(base.html.match(/\/webzine\/news\/\?news=\d+/g) || []).length}`,
      `upload_imgs=${(base.html.match(/upload\d*\.inven\.co\.kr\/upload/g) || []).length}`,
      `calendar_items=${(base.html.match(/<li class="calendar__item/g) || []).length}`,
    ].join("\n");
    await writeFile(join(ROOT, "data/_inven-debug.txt"), dbg + "\n");
  } catch { /* 디버그 기록 실패는 무시 */ }

  if (!base.html || base.status >= 400) return { name: "Inven", error: `status=${base.status} ${base.err}`.trim(), added: 0 };

  const seen = new Set();
  let added = parseInvenCalendar(base.html, out, seen);

  // 올해(이번 달 제외) 나머지 월도 수집해 6월 이전/이후 일정까지 채운다.
  // 인벤이 쓰는 월 파라미터 형식을 모르므로, 후보 형식을 프로브 월로 시험해
  // "요청한 월을 실제로 돌려주는" 형식을 자가 탐지한 뒤 그 형식으로 1~12월을 순회한다.
  // (픽스처 테스트 시에는 네트워크 순회를 생략)
  if (!process.env.INVEN_HTML_FILE) {
    const pad = (n) => String(n).padStart(2, "0");
    const B = INVEN_CAL.url;
    const fmts = [
      (y, m) => `${B}?y=${y}&m=${m}`,
      (y, m) => `${B}?year=${y}&month=${m}`,
      (y, m) => `${B}?date=${y}-${pad(m)}`,
      (y, m) => `${B}?d=${y}-${pad(m)}`,
      (y, m) => `${B}?ym=${y}${pad(m)}`,
      (y, m) => `${B}?sdate=${y}-${pad(m)}-01`,
      (y, m) => `${B}${y}/${pad(m)}/`,
      (y, m) => `${B}${y}/${pad(m)}`,    // 인벤 실제 경로(/2026/13 등, trailing slash 없음)
    ];
    const Y = TODAY.getFullYear();
    const cur = TODAY.getMonth() + 1;
    const probe = cur >= 4 ? cur - 2 : cur + 2;     // 현재월이 아닌 프로브 월
    const wantProbe = `${Y}${pad(probe)}`;

    let fmt = null; const log = [];
    for (const f of fmts) {
      const url = f(Y, probe);
      const { html, status } = await invenFetch(url);
      const ok = status === 200 && invenMonths(html).has(wantProbe);
      log.push(`${url.slice(B.length) || "/"}=${status}${ok ? "✓" : ""}`);
      if (ok) { fmt = f; break; }
    }
    console.log(`[inven] 월 파라미터 탐지(probe ${wantProbe}): ${log.join(" ")} => ${fmt ? "발견" : "미발견(현재 월만 수집)"}`);

    if (fmt) {
      let monthsHit = 0;
      // 현재 연도 나머지 월
      for (let m = 1; m <= 12; m++) {
        if (m === cur) continue;
        const { html, status } = await invenFetch(fmt(Y, m));
        if (status !== 200 || !html) continue;
        const n = parseInvenCalendar(html, out, seen);
        if (n) monthsHit++;
        added += n;
      }
      // 내년(Y+1) 전체 월 — 2027+ 일정이 인벤에 등록되면 자동 수집
      for (let m = 1; m <= 12; m++) {
        const { html, status } = await invenFetch(fmt(Y + 1, m));
        if (status !== 200 || !html) continue;
        const n = parseInvenCalendar(html, out, seen);
        if (n) monthsHit++;
        added += n;
      }
      console.log(`[inven] ${Y}~${Y + 1}년 월별 수집 완료: 추가 월 ${monthsHit} · 누적 일정 ${added}`);
    }

    // 미정(TBD) 페이지 수집: 인벤 월=13이 "출시일 미정" 목록.
    // 날짜 확정 항목이 TBD 목록에서 사라지면 자동으로 월별 스케줄로 이동됨.
    const fetchTbd = async (year) => {
      const urls = new Set([`${B}${year}/13`, `${B}${year}/13/`]);
      if (fmt) urls.add(fmt(year, 13));
      for (const u of urls) {
        const { html, status } = await invenFetch(u);
        if (status === 200 && html && html.includes("calendar__item")) {
          const n = parseInvenCalendar(html, out, seen, true);
          console.log(`[inven] TBD ${year}: ${u} status=${status} added=${n}`);
          added += n;
          return;
        }
      }
    };
    await fetchTbd(Y);
    await fetchTbd(Y + 1);
  }

  return { name: "Inven", added };
}

// 인벤 게임 상세 페이지 본문 컨테이너 후보(앱 내 미리보기 본문용). 구조 변경에 대비해 여러 후보를 시도.
const INVEN_GAME_BODY_PATS = [
  /itemprop=["']description["']/i,
  /class=["'][^"']*\bgame[_-]?(?:info|desc|detail|intro|story|summary|content)\b[^"']*["']/i,
  /class=["'][^"']*\bcalendar__(?:detail|desc|info|content|story)\b[^"']*["']/i,
  /class=["'][^"']*\b(?:view_content|board_main_view|article_view)\b[^"']*["']/i,
];

// 게임 상세 본문 보강: 인벤 게임 상세 페이지에서 og:description·본문을 받아 description/content[] 로
// 저장(앱 내 미리보기용). 직전 games.json 에서 캐시해 매 빌드 전체 재요청을 피하고, 회당 일부만
// 점진적으로 수집한다(가까운 일정 우선). 러너에서만 동작(INVEN=1), 픽스처 모드에서는 생략.
const DETAIL_MAX = 140; // 회당 신규 상세 페이지 요청 상한
async function enrichGameDetails(games, prev) {
  if (process.env.INVEN !== "1") return { name: "GameDetails", skipped: "INVEN!=1" };
  if (process.env.INVEN_HTML_FILE) return { name: "GameDetails", skipped: "fixture" };

  // 1) 직전 데이터에서 본문/설명 이월 — id 기준. _dlong=상세 본문 수집 완료 표식.
  const prevById = new Map();
  for (const p of (prev && prev.games) || []) if (p.id) prevById.set(p.id, p);
  for (const g of games) {
    const p = prevById.get(g.id);
    if (!p) continue;
    if ((!g.content || !g.content.length) && p.content && p.content.length) g.content = p.content;
    if (p._dlong) {
      if (p.description && p.description.length > (g.description ? g.description.length : 0)) g.description = p.description;
      g._dlong = true;
    }
  }

  // 2) 아직 보강하지 않은 게임만 회당 상한까지 수집(예정 → 지난 → 미정 순).
  const isGamePage = (u) => /inven\.co\.kr\/webzine\/calendar\/game\/\d+/.test(u || "");
  const today = iso(TODAY);
  const relevance = (g) => (g.releaseDate === "TBD" || !g.releaseDate) ? 2 : (g.releaseDate >= today ? 0 : 1);
  const targets = games
    .filter((g) => isGamePage(g.detailUrl) && !g._dlong)
    .sort((a, b) => relevance(a) - relevance(b) || String(a.releaseDate).localeCompare(String(b.releaseDate)))
    .slice(0, DETAIL_MAX);

  let bodies = 0, descs = 0, fetched = 0;
  const enrichOne = async (g) => {
    try {
      const res = await fetch(g.detailUrl, { headers: { ...HEADERS, referer: INVEN_CAL.url }, signal: AbortSignal.timeout(10000) });
      if (!res.ok) return;                                   // 실패는 다음 빌드에서 재시도(_dlong 미설정)
      fetched++;
      const h = await res.text();
      const c = extractContent(h, INVEN_GAME_BODY_PATS);     // 본문 블록(단락·이미지·영상)
      if (c.length) { g.content = c; bodies++; }
      const og = (h.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)
        || h.match(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:description["']/i) || [])[1];
      const ogTxt = og ? rwText(og) : "";
      if (ogTxt && ogTxt.length > (g.description ? g.description.length : 0)) { g.description = ogTxt.slice(0, 600); descs++; }
      g._dlong = true;                                       // 성공 시 표식(빈 본문이어도 재요청 방지)
    } catch { /* 개별 실패 무시 — 다음 빌드에서 재시도 */ }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < targets.length; i += 6) {              // 동시 요청을 낮춰 차단(레이트리밋) 완화
    await Promise.all(targets.slice(i, i + 6).map(enrichOne));
    if (i + 6 < targets.length) await sleep(120);
  }
  const withBody = games.filter((g) => g.content && g.content.length).length;
  console.log(`[gamedetail] 대상 ${targets.length} · 성공 ${fetched} · 신규본문 ${bodies} · 신규설명 ${descs} · 누적본문 ${withBody}/${games.length}`);
  return { name: "GameDetails", added: bodies };
}

// 루리웹 게임 뉴스 수집. 러너에서만 동작(NEWS=1). 여러 소스를 순회하고 중복 제거.
const RULIWEB_SOURCES = [
  "https://bbs.ruliweb.com/news",            // 데스크톱 뉴스 목록(썸네일+요약+조회수+시각+댓글수)
  "https://bbs.ruliweb.com/news?page=2",
  "https://bbs.ruliweb.com/news?page=3",
  "https://bbs.ruliweb.com/news/board/1001",       // 게임 뉴스 게시판
  "https://bbs.ruliweb.com/news/board/1001?page=2",
];
// HTML 텍스트/엔티티 정리
const rwText = (s) => (s || "")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ").trim();

// ── 기사 본문 추출(앱 내 다크 상세뷰용) ───────────────────────────────────
// 본문 영역만 잘라낸다. itemprop=articleBody(스키마) → .view_content 순으로 시도하고,
// 출처/추천/관련글/댓글 영역이 시작되면 그 앞에서 컷한다.
function articleRegion(html, pats) {
  // 본문 컨테이너 후보(루리웹은 글 유형/게시판에 따라 클래스가 다양함).
  // pats 를 넘기면 다른 사이트(예: 인벤 게임 상세)의 컨테이너로 교체할 수 있다.
  const PATS = pats || [
    /itemprop=["']articleBody["']/i,
    /class=["'][^"']*\bview_content\b[^"']*["']/i,
    /class=["'][^"']*\bboard_main_view\b[^"']*["']/i,
    /class=["'][^"']*\barticle_view_wrapper\b[^"']*["']/i,
    /id=["']memo_\d+["']/i,
  ];
  let i = -1;
  for (const p of PATS) { i = html.search(p); if (i >= 0) break; }
  if (i < 0) return "";
  const gt = html.indexOf(">", i);            // 여는 태그를 건너뛰어 본문 시작부터
  const from = gt >= 0 ? gt + 1 : i;
  let region = html.slice(from, from + 200000);  // 전체 본문 확보(긴 글 대비)
  // 출처/추천/관련글/댓글 영역의 '여는 태그' 앞에서 컷(부분 태그가 남지 않도록 '<' 포함)
  const cut = region.search(/<[^>]*class=["'][^"']*(source_url|like_wrapper|btn_list|relation_news|board_bottom|view_bottom|reply_count|reply_list|comment_wrapper|board_bottom_layer)/i);
  if (cut > 0) region = region.slice(0, cut);
  return region;
}
// HTML 조각 → 단락 배열. 각 단락은 세그먼트 배열: {t:"t",v} 텍스트 | {t:"a",v:url,l:label} 링크.
// (본문 속 http(s) 하이퍼링크를 보존해 미리보기에서 클릭 가능하게 함)
function htmlToParaSegs(frag) {
  const s = frag
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, "\n\n");
  const decode = (t) => {
    let x = String(t || "").replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ");
    const lead = /^\s/.test(x), trail = /\s$/.test(x);
    x = x.replace(/\s+/g, " ").trim();
    return x ? (lead ? " " : "") + x + (trail ? " " : "") : "";
  };
  const out = [];
  for (const para of s.split(/\n{2,}/)) {
    const segs = [];
    const aRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let li = 0, am;
    const pushTxt = (chunk) => { const t = decode(chunk); if (t) segs.push({ t: "t", v: t }); };
    while ((am = aRe.exec(para))) {
      pushTxt(para.slice(li, am.index));
      li = am.index + am[0].length;
      const href = am[1].replace(/&amp;/g, "&").trim();
      const label = decode(am[2]).trim();
      if (/^https?:\/\//i.test(href) && label) segs.push({ t: "a", v: href, l: label.slice(0, 160) });
      else if (label) segs.push({ t: "t", v: label });
    }
    pushTxt(para.slice(li));
    // 인접 텍스트 병합 후 양끝 공백 정리
    const merged = [];
    for (const sg of segs) {
      if (sg.t === "t" && merged.length && merged[merged.length - 1].t === "t") merged[merged.length - 1].v += sg.v;
      else merged.push({ ...sg });
    }
    if (merged.length) {
      if (merged[0].t === "t") merged[0].v = merged[0].v.replace(/^\s+/, "");
      const lastSeg = merged[merged.length - 1];
      if (lastSeg.t === "t") lastSeg.v = lastSeg.v.replace(/\s+$/, "");
    }
    const textLen = merged.reduce((n, sg) => n + (sg.t === "t" ? sg.v.length : 0), 0);
    const cleaned = merged.filter((sg) => sg.t === "a" || sg.v.length);
    if (cleaned.length && (cleaned.some((sg) => sg.t === "a") || textLen > 1)) out.push(cleaned);
  }
  return out;
}
// 본문을 읽기용 블록 배열로: [{t:"p",v|seg} | {t:"img"} | {t:"yt"}] (원문 순서 그대로 유지)
function extractContent(html, regionPats) {
  const region = articleRegion(html, regionPats);
  if (!region) return [];
  const blocks = [];
  const seenYt = new Set();
  let last = 0, m, textLen = 0;
  // 전체 본문 표시 — 폭주 방지용 넉넉한 상한만(사실상 전체 기사)
  const MAX_BLOCKS = 300, MAX_TEXT = 20000;
  const pushText = (frag) => {
    for (const segs of htmlToParaSegs(frag)) {
      if (textLen > MAX_TEXT || blocks.length >= MAX_BLOCKS) break;
      textLen += segs.reduce((n, s) => n + (s.v ? s.v.length : 0), 0);
      if (segs.some((s) => s.t === "a")) blocks.push({ t: "p", seg: segs });        // 링크 포함 단락
      else { const v = segs.map((s) => s.v).join("").trim(); if (v.length > 1) blocks.push({ t: "p", v }); }
    }
  };
  // 이미지(<img>)와 유튜브 임베드(<iframe>/<a>)를 '문서 순서대로' 함께 스캔 → 원문과 같은 위치.
  // 태그 '전체'를 토큰으로 잡아야 본문에 태그 파편이 남지 않는다.
  const TOKEN = /<img\b[^>]*>|<iframe\b[^>]*>|<a\b[^>]*(?:youtube|youtu\.be)[^>]*>/gi;
  const YT = /(?:youtube(?:-nocookie)?\.com\/(?:embed\/|v\/|watch\?v=)|youtu\.be\/)([A-Za-z0-9_-]{8,})/i;
  while ((m = TOKEN.exec(region)) && blocks.length < MAX_BLOCKS) {
    pushText(region.slice(last, m.index));
    last = m.index + m[0].length;
    const tag = m[0];
    if (/^<img/i.test(tag)) {
      // 지연로딩 등 다양한 속성에서 이미지 URL 확보
      let src = (tag.match(/(?:data-original|data-src|data-echo|data-lazy(?:-src)?|src)=["']([^"']+)["']/i) || [])[1];
      if (!src || /blank|emoticon|icon|button|loading|\bs\.gif\b|spacer|1x1|pixel/i.test(src)) continue;
      if (src.startsWith("//")) src = "https:" + src;
      if (/^https?:/i.test(src)) blocks.push({ t: "img", v: src.replace(/&amp;/g, "&") });
    } else {
      // <iframe>/유튜브 링크 → 동영상 블록(같은 영상은 1회만)
      const id = (tag.match(YT) || [])[1];
      if (id && !seenYt.has(id)) { seenYt.add(id); blocks.push({ t: "yt", v: id }); }
    }
  }
  pushText(region.slice(last));
  return blocks.slice(0, MAX_BLOCKS);
}
// 기사 페이지에서 댓글 수 추출(목록에 댓글 수가 없는 board/1001 글 보강용)
function extractCommentCount(html) {
  const m = html.match(/"comment_?count"\s*:\s*(\d+)/i)
    || html.match(/comment_count[^>]*>[\s\S]{0,40}?(\d[\d,]*)/i)
    || html.match(/class="num_reply"[^>]*>\s*\[?\s*(\d[\d,]*)/i)
    || html.match(/댓글[\s:]*<[^>]*>\s*(\d[\d,]*)/)
    || html.match(/댓글[\s:(]*(\d[\d,]*)/);
  return m ? +m[1].replace(/,/g, "") : null;
}
// 기사 페이지에서 댓글 추출(작성자·내용·추천·베스트 여부). 미리보기에 전체 인라인 노출.
function extractComments(html, max = 100) {
  let s = html.search(/class=["'][^"']*comment_(?:view|table|wrapper)|id=["']cmt["']/i);
  if (s < 0) return [];
  const region = html.slice(s, s + 500000);
  const out = [];
  const seenText = new Set();
  const parts = region.split(/class="comment_element/);
  for (let i = 1; i < parts.length && out.length < max; i++) {
    const blk = parts[i].slice(0, 6000);
    const head = parts[i].slice(0, 120);
    const isBest = /\bbest\b/i.test(head) || /icon_best|best_icon|comment_best/i.test(blk.slice(0, 600));
    const nick = rwText((blk.match(/class="[^"]*\bnick\b[^"]*"[^>]*>([\s\S]*?)<\/(?:strong|span|a)>/i) || [])[1]) || null;
    // 블록 내 text_wrapper 후보 중 라벨/닉네임/기본닉을 빼고 가장 실질적인(긴) 텍스트 = 실제 댓글.
    // 닫는 태그는 래퍼 컨테이너(span·div·p)만 인정 → 본문 속 <a>·<strong> 에서 잘리지 않게.
    let text = "";
    for (const tm of blk.matchAll(/class="text_wrapper"[^>]*>([\s\S]*?)<\/(?:span|div|p)>/gi)) {
      const t = rwText(tm[1]);
      if (!t || t.length < 1) continue;
      if (/^(BEST|베스트|공지|블라인드|신고|답글|신고하기)$/i.test(t)) continue;
      if (nick && t === nick) continue;            // 닉네임 칸 제외
      if (/^루리웹-\d+$/.test(t)) continue;          // 기본 닉네임 제외
      if (t.length > text.length) text = t;          // 가장 긴 것이 실제 댓글 본문
    }
    if (text) {
      const key = text.slice(0, 40);
      if (seenText.has(key)) continue;               // best+일반 목록 중복 제거
      seenText.add(key);
    }
    // 댓글에 첨부된 이미지(이모티콘·프로필·아이콘 제외)
    const imgs = [];
    for (const im of blk.matchAll(/<img\b[^>]*?(?:data-original|data-src|src)=["']([^"']+)["'][^>]*>/gi)) {
      let u = (im[1] || "").trim();
      if (!u || /emoticon|dccon\/icon|\/button|blank|spacer|1x1|pixel|profile|avatar|\/member|nophoto|default[_-]|\/bi[._]/i.test(u)) continue;
      if (u.startsWith("//")) u = "https:" + u;
      if (!/^https?:/i.test(u)) continue;
      u = u.replace(/&amp;/g, "&");
      if (!imgs.includes(u)) imgs.push(u);
      if (imgs.length >= 4) break;
    }
    if (!text && !imgs.length) continue;             // 내용·이미지 모두 없으면 스킵
    const likeM = blk.match(/class="[^"]*\b(?:like|recomd|num)\b[^"]*"[^>]*>\s*(\d+)/i);
    out.push({
      nick: nick ? nick.slice(0, 24) : null,
      text: text.slice(0, 400),
      like: likeM ? +likeM[1] : null,
      ...(isBest ? { best: true } : {}),
      ...(imgs.length ? { imgs } : {}),
    });
  }
  return out;
}
// 작성자(닉네임) 추출
function extractAuthor(html) {
  const el = (html.match(/<(?:strong|span|a)[^>]*class="[^"]*\bnick(?:name)?\b[^"]*"[^>]*>([\s\S]*?)<\/(?:strong|span|a)>/i) || [])[1];
  if (el) { const t = rwText(el); if (t && t.length <= 30) return t; }
  const meta = (html.match(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i) || [])[1];
  return meta ? rwText(meta).slice(0, 30) || null : null;
}
// 기사 작성일시 추출(board/1001 등 목록에 날짜가 없는 글용).
// 구조화 신호(JSON-LD/og/article:published_time)를 먼저, 없으면 헤더의 노출 날짜를 본다.
// 본문 속 날짜 오탐을 줄이려 본문(articleBody) 시작 이전 영역에서만 탐색.
function extractDateTime(html) {
  let end = html.search(/itemprop=["']articleBody["']/i);
  if (end < 0) end = html.search(/class=["'][^"']*\bview_content\b[^"']*["']/i);
  const head = html.slice(0, end > 0 ? end : Math.min(html.length, 40000));
  let m = head.match(/(?:"datePublished"\s*:\s*"|(?:article:published_time|og:regdate)["'][^>]+content=["'])(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?/i);
  if (m) return { date: `${m[1]}.${m[2]}.${m[3]}`, time: m[4] || null };
  m = head.match(/(20\d{2})[.\-](\d{1,2})[.\-](\d{1,2})[\s(]+(\d{1,2}:\d{2})(?::\d{2})?/);
  if (m) return { date: `${m[1]}.${String(m[2]).padStart(2, "0")}.${String(m[3]).padStart(2, "0")}`, time: m[4] };
  return null;
}

// 데스크톱 뉴스의 <section class="center_list"> 리치 목록(썸네일·요약·댓글수·시각·조회수)
function parseRuliwebList(html, news, seen, cap = 60) {
  const start = html.indexOf('class="center_list"');
  const sec = start >= 0 ? html.slice(start) : html;
  let added = 0;
  for (const m of sec.matchAll(/<div id="news_(\d+)"[\s\S]*?(?=<div id="news_\d+"|<\/section>|$)/g)) {
    const id = m[1], block = m[0];
    if (seen.has("id:" + id)) continue;
    const title = rwText((block.match(/<strong class="title">([\s\S]*?)<\/strong>/) || [])[1]);
    if (!title || title.length < 4) continue;
    const summary = rwText((block.match(/<span class="desc">([\s\S]*?)<\/span>/) || [])[1]);
    const comments = (block.match(/<span class="num_reply">\s*\[(\d+)\]/) || [])[1];
    const ct = rwText((block.match(/<span class="create_time">([\s\S]*?)<\/span>/) || [])[1]); // "2026.06.02 (16:07:10), 조회수 132"
    const dm = ct.match(/(\d{4})\.(\d{2})\.(\d{2})\s*\(([\d:]+)\)/);
    const vm = ct.match(/조회수\s*([\d,]+)/);
    let image = (block.match(/background-image:\s*url\(([^),]+)/) || [])[1] || null;
    if (image) { image = image.trim().replace(/^['"]/g, "").replace(/['"]/g, ""); if (image.startsWith("//")) image = "https:" + image; }
    seen.add("id:" + id); seen.add(title.toLowerCase().replace(/\s+/g, ""));
    const item = {
      id: `ruliweb-${id}`, title, url: `https://bbs.ruliweb.com/news/read/${id}`,
      source: RULIWEB_NEWS.name,
      date: dm ? `${dm[1]}.${dm[2]}.${dm[3]}` : null,
      time: dm ? dm[4] : null,
      views: vm ? +vm[1].replace(/,/g, "") : null,
      comments: comments != null ? +comments : null,
      summary: summary || null,
      image,
    };
    news.push(item);
    if (++added >= cap) break;
  }
  return added;
}
const RW_IMG = /<(?:img|source)[^>]+(?:data-src|src|srcset)="(https?:\/\/[^"]*ruliweb\.com\/[^"]*news\/[^"]+\.(?:jpe?g|png|gif|webp))/i;
const rwAbsImg = (u) => u ? (u.startsWith("//") ? "https:" + u : u) : null;

// 한 페이지 HTML 에서 기사들을 추출(기사ID로 그룹핑). seen 으로 소스 간 중복 제거.
function parseRuliweb(html, news, seen, cap = 40) {
  const anchors = [];
  for (const m of html.matchAll(/<a[^>]+href="([^"]*\/news\/(?:board\/\d+\/)?read\/(\d+)[^"]*)[^>]*>([\s\S]*?)<\/a>/gi)) {
    anchors.push({ idx: m.index, url: m[1], id: m[2], inner: m[3] });
  }
  const byId = new Map();
  for (const a of anchors) { if (!byId.has(a.id)) byId.set(a.id, []); byId.get(a.id).push(a); }

  let added = 0;
  for (const [id, group] of byId) {
    let title = "";
    for (const a of group) {
      const t = a.inner.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
      if (t.length > title.length) title = t;
    }
    title = title.replace(/\s*\[\d+\]\s*$/, "").trim();   // 끝의 댓글수 [N] 제거
    if (!title || title.length < 6) continue;
    const key = title.toLowerCase().replace(/\s+/g, "");
    if (seen.has(key) || seen.has("id:" + id)) continue;  // 중복 제거(제목/ID, 소스 간 공통)
    seen.add(key); seen.add("id:" + id);
    let url = group[0].url.replace(/&amp;/g, "&");
    if (url.startsWith("/")) url = "https://bbs.ruliweb.com" + url;
    url = url.replace(/^https?:\/\/m\.ruliweb\.com/, "https://bbs.ruliweb.com"); // 데스크톱 글페이지(본문 표시 안정)
    let image = null;
    for (const a of group) { const im = a.inner.match(RW_IMG); if (im) { image = rwAbsImg(im[1]); break; } }
    if (!image) {
      for (const a of group) {
        const win = html.slice(Math.max(0, a.idx - 1200), a.idx + a.inner.length + 600);
        const im = win.match(RW_IMG);
        if (im) { image = rwAbsImg(im[1]); break; }
      }
    }
    const a0 = group[0]; const dwin = html.slice(a0.idx, a0.idx + a0.inner.length + 500);
    const date = (dwin.match(/20\d{2}[.\-]\d{1,2}[.\-]\d{1,2}/) || [])[0] || null; // YYYY.MM.DD 만(가짜 MM.DD 제거)
    news.push({ id: `ruliweb-${id}`, title, url, source: RULIWEB_NEWS.name, date, image });
    if (++added >= cap) break;
  }
  return added;
}

// 제목 유사도(문자 bigram Dice) 기반 뉴스 중복 제거 — 유사 글은 최신만 유지
function newsRecency(n) {
  if (!n || !n.date) return 0;
  const p = String(n.date).split(".");
  if (p.length < 3) return 0;
  return new Date(`${p[0]}-${p[1]}-${p[2]}T${n.time || "00:00"}`).getTime() || 0;
}
function diceCoef(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bg = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const A = bg(a), B = bg(b);
  let inter = 0, total = 0;
  for (const [g, c] of A) { total += c; inter += Math.min(c, B.get(g) || 0); }
  for (const [, c] of B) total += c;
  return total ? (2 * inter) / total : 0;
}
function dedupNewsByTitle(items, threshold = 0.8) {
  const norm = (t) => String(t || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""); // 공백·기호 제거
  const sorted = [...items].sort((a, b) => newsRecency(b) - newsRecency(a)); // 최신 우선
  const kept = [];
  for (const n of sorted) {
    const key = norm(n.title);
    if (!key) continue;
    if (kept.some((k) => diceCoef(key, k.__k) >= threshold)) continue; // 유사 → 더 오래된 중복이므로 스킵
    n.__k = key; kept.push(n);
  }
  for (const k of kept) delete k.__k;
  return kept;
}

async function fromRuliwebNews(news) {
  if (process.env.NEWS !== "1") return { name: "RuliwebNews", skipped: "NEWS!=1" };
  const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
  const seen = new Set();
  let added = 0; const errs = [];
  for (const url of RULIWEB_SOURCES) {
    let html = "", status = 0, err = "";
    const ua = url.includes("m.ruliweb.com") ? MOBILE_UA : DESKTOP_UA; // 데스크톱 뉴스는 요약/조회수/시각 포함
    try {
      const res = await fetch(url, { headers: { ...HEADERS, "user-agent": ua }, redirect: "follow" });
      status = res.status; html = await res.text();
    } catch (e) { err = String(e && e.message || e); }
    console.log(`[ruliweb] ${url} status=${status} len=${html.length} links=${(html.match(/\/news\/(?:board\/\d+\/)?read\/\d+/g) || []).length} err=${err}`);
    if (!html || status >= 400) { errs.push(`${url}=${status}`); continue; }
    let n = parseRuliwebList(html, news, seen, 60);      // 데스크톱 뉴스 리치 목록 우선
    if (n < 5) n += parseRuliweb(html, news, seen, 40);  // 게시판/구조 변경 시 폴백(제목·링크)
    console.log(`[ruliweb] ${url} parsed ${n}`);
    added += n;
  }

  // 본문 보강 전에 유사 중복 제거 + 게시판 공지/안내 글 제외(뉴스 아님).
  const NOTICE = /공지|필독|이용\s*안내|운영\s*정책|^[▦◆■]|게시판\s*안내/;
  const deduped = dedupNewsByTitle(news, 0.8).filter((n) => !NOTICE.test(n.title || ""));
  news.length = 0; news.push(...deduped);

  // 각 기사 페이지에서 본문(content)·작성자·썸네일·요약·날짜를 보강해 앱 내 상세뷰에 사용.
  // board/1001(콘솔 유저 정보) 글은 목록에 날짜가 없어 정렬 시 바닥으로 가라앉으므로,
  // 날짜 없는 글을 먼저 보강해 날짜를 반드시 채운다. (referer 헤더 필수)
  const targets = [...news].sort((a, b) => (a.date ? 1 : 0) - (b.date ? 1 : 0)).slice(0, 110);
  const enrichOne = async (n) => {
    try {
      const res = await fetch(n.url, { headers: { ...HEADERS, "user-agent": DESKTOP_UA, referer: "https://bbs.ruliweb.com/news/board/1001" }, signal: AbortSignal.timeout(10000) });
      if (!res.ok) return;
      const h = await res.text();
      const og = (h.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
        || h.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) || [])[1];
      if (!n.image && og && !/blank|default|logo|no_?image|bi\.png|icon/i.test(og)) n.image = og.replace(/&amp;/g, "&");
      if (!n.summary) { const d = (h.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i) || [])[1]; if (d) n.summary = rwText(d).slice(0, 160) || null; }
      if (!n.date) { const d = extractDateTime(h); if (d) { n.date = d.date; if (d.time) n.time = d.time; } }
      if (!n.author) { const a = extractAuthor(h); if (a) n.author = a; }
      if (!n.content || !n.content.length) { const c = extractContent(h); if (c.length) n.content = c; }
      if (!n.image && n.content) {                 // 영상/이미지 글 썸네일 보강(목록 노출용)
        const im = n.content.find((b) => b.t === "img");
        const yt = n.content.find((b) => b.t === "yt");
        if (im) n.image = im.v;
        else if (yt) n.image = `https://img.youtube.com/vi/${yt.v}/hqdefault.jpg`;
      }
      if (n.comments == null) { const c = extractCommentCount(h); if (c != null) n.comments = c; } // 댓글 수 보강
      if (!n.topComments) { const cs = extractComments(h, 100); if (cs.length) n.topComments = cs; } // 전체 댓글
    } catch { /* 개별 실패 무시 */ }
  };
  let withDate = 0, withBody = 0, withCmt = 0, withCmtList = 0, withLink = 0, withCmtImg = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < targets.length; i += 6) {        // 동시 요청을 낮춰 차단(레이트리밋) 완화
    await Promise.all(targets.slice(i, i + 6).map((n) => enrichOne(n)));
    if (i + 6 < targets.length) await sleep(120);        // 배치 간 약간의 간격
  }
  for (const n of news) {
    if (n.date) withDate++;
    if (n.content && n.content.length) withBody++;
    if (n.comments != null) withCmt++;
    if (n.topComments && n.topComments.length) withCmtList++;
    if (n.content && n.content.some((b) => b.t === "p" && b.seg)) withLink++;
    if (n.topComments && n.topComments.some((c) => c.imgs && c.imgs.length)) withCmtImg++;
  }
  console.log(`[ruliweb] 보강 대상 ${targets.length} · 날짜 ${withDate}/${news.length} · 본문 ${withBody}/${news.length} · 댓글수 ${withCmt} · 댓글목록 ${withCmtList} · 본문링크 ${withLink} · 댓글이미지 ${withCmtImg}`);
  return { name: "RuliwebNews", ...(errs.length ? { error: errs.join(",") } : {}), added };
}

async function fromSteam(out) {
  if (process.env.STEAM !== "1") return { name: "Steam", skipped: "STEAM!=1" };
  const res = await fetch("https://store.steampowered.com/api/featuredcategories?l=koreana&cc=kr");
  if (!res.ok) throw new Error(`Steam HTTP ${res.status}`);
  const data = await res.json();
  const items = data?.coming_soon?.items || [];
  let added = 0;
  for (const it of items) {
    out.push(makeGame({
      id: `steam-${it.id}`,
      title: it.name,
      platforms: ["PC"],
      genres: [],
      releaseDate: iso(WINDOW_TO), // 정확한 날짜 미제공 → 향후로 표시(추후 appdetails로 보강 가능)
      price: it.final_price ? Math.round(it.final_price * 10) : 0,
      tags: ["Steam"],
      eventType: "release",
      source: { name: "Steam", url: `https://store.steampowered.com/app/${it.id}` },
    }));
    added++;
  }
  return { name: "Steam", added };
}

async function fromRSS(out) {
  if (process.env.RSS !== "1") return { name: "RSS", skipped: "RSS!=1" };
  const FEEDS = [
    { name: "인벤 발매 캘린더", url: "https://feed.inven.co.kr/news/", home: "https://www.inven.co.kr/webzine/calendar/" },
  ];
  const evFromText = (s) =>
    /사전\s*예약|사전예약/.test(s) ? "prereg" :
    /\bOBT\b|오픈\s*베타/i.test(s) ? "obt" :
    /\bCBT\b|비공개\s*테스트/i.test(s) ? "cbt" :
    /업데이트|패치|시즌/.test(s) ? "update" : "release";
  let added = 0;
  for (const f of FEEDS) {
    try {
      const res = await fetch(f.url, { headers: { "user-agent": "GNW/1.0" } });
      if (!res.ok) continue;
      const xml = await res.text();
      const items = [...xml.matchAll(/<item[\s\S]*?<\/item>/gi)].slice(0, 15);
      for (const m of items) {
        const block = m[0];
        const title = (block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i) || [])[1]?.trim();
        const link = (block.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i) || [])[1]?.trim();
        const pub = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1]?.trim();
        if (!title) continue;
        const date = pub && !isNaN(new Date(pub)) ? iso(new Date(pub)) : iso(TODAY);
        out.push(makeGame({
          id: `rss-${slug(title)}`,
          title, titleKr: title,
          platforms: [], genres: [],
          releaseDate: date,
          eventType: evFromText(title),
          tags: ["뉴스"],
          description: "게임 매체 뉴스 헤드라인",
          source: { name: f.name, url: link || f.home || f.url },
        }));
        added++;
      }
    } catch { /* skip feed */ }
  }
  return { name: "RSS", added };
}

/* ---------- Merge & write ---------- */
async function main() {
  const curated = JSON.parse(await readFile(join(ROOT, "data/curated.json"), "utf8"));
  const outPath = join(ROOT, "data/games.json");
  let prev = null;
  try { prev = JSON.parse(await readFile(outPath, "utf8")); } catch { /* 최초 생성 */ }

  const collected = [];
  const newsItems = [];
  const report = [];

  // 일정: 인벤 발매 캘린더 / 뉴스: 루리웹 (둘 다 러너에서만 외부 접근 가능)
  for (const provider of [fromInven]) {
    try {
      report.push(await provider(collected));
    } catch (e) {
      report.push({ name: provider.name, error: e.message });
    }
  }
  try { report.push(await fromRuliwebNews(newsItems)); }
  catch (e) { report.push({ name: "RuliwebNews", error: e.message }); }

  // 병합: curated 우선. 인벤 수집본은 같은 게임이면 큐레이션을 "보강"하고(직접 상세링크·
  // 썸네일·플랫폼·트레일러), 큐레이션에 없는 새 일정만 추가한다. 매칭은 원제/한글제목 모두로.
  const keyset = (g) => [...new Set([normTitle(g.title), normTitle(g.titleKr || g.title)].filter(Boolean))];
  const curatedByKey = new Map();
  for (const g of curated.games) for (const k of keyset(g)) curatedByKey.set(k, g);

  const usedCollected = new Set();
  for (const c of collected) {
    const hit = keyset(c).map((k) => curatedByKey.get(k)).find(Boolean);
    if (!hit) continue;
    if (c.detailUrl) hit.detailUrl = c.detailUrl;                 // 인벤 직접 상세링크로 교체
    if (!hit.image && c.image) hit.image = c.image;               // 썸네일 보강
    if ((!hit.platforms || !hit.platforms.length) && c.platforms.length) hit.platforms = c.platforms;
    if (c.trailer && /youtu/.test(c.trailer) && (!hit.trailer || /results\?search_query/.test(hit.trailer))) hit.trailer = c.trailer;
    usedCollected.add(c);
  }

  const byKey = new Map();
  for (const g of curated.games) byKey.set("c|" + normTitle(g.titleKr || g.title), g);
  for (const c of collected) if (!usedCollected.has(c)) byKey.set("i|" + normTitle(c.titleKr || c.title), c); // 새 일정만
  for (const g of byKey.values()) if (!g.detailUrl) g.detailUrl = detailFor(g.titleKr || g.title); // 폴백: 본 제목 검색

  const games = [...byKey.values()]
    .filter((g) => g.releaseDate === "TBD" || (g.releaseDate && !isNaN(new Date(g.releaseDate))))
    .sort((a, b) => {
      // TBD 항목은 항상 맨 뒤
      if (a.releaseDate === "TBD" && b.releaseDate === "TBD") return 0;
      if (a.releaseDate === "TBD") return 1;
      if (b.releaseDate === "TBD") return -1;
      return new Date(a.releaseDate) - new Date(b.releaseDate);
    });

  // 게임 상세 본문 보강(앱 내 미리보기용). 직전 games.json 캐시 + 회당 점진 수집.
  try { report.push(await enrichGameDetails(games, prev)); }
  catch (e) { report.push({ name: "GameDetails", error: e.message }); }

  // 뉴스: 제목이 80% 이상 유사하면 최신 글만 남기고 중복 제거. 수집 실패/스킵 시 기존 뉴스 유지.
  let news = dedupNewsByTitle(newsItems, 0.8);
  if (!news.length && prev && Array.isArray(prev.news)) news = prev.news;

  // 비파괴 병합: 루리웹이 일시적으로 기사 페이지 요청을 막아 본문/댓글/날짜를 못 받은 경우,
  // 직전 games.json 의 같은 글(url/id) 값으로 채워 기존에 모은 풍부한 데이터를 잃지 않는다.
  if (prev && Array.isArray(prev.news)) {
    const byUrl = new Map(), byId = new Map();
    for (const p of prev.news) { if (p.url) byUrl.set(p.url, p); if (p.id) byId.set(p.id, p); }
    for (const n of news) {
      const p = byUrl.get(n.url) || byId.get(n.id);
      if (!p) continue;
      if ((!n.content || !n.content.length) && p.content && p.content.length) n.content = p.content;
      if ((!n.topComments || !n.topComments.length) && p.topComments && p.topComments.length) n.topComments = p.topComments;
      if (n.comments == null && p.comments != null) n.comments = p.comments;
      if (!n.date && p.date) { n.date = p.date; if (p.time) n.time = p.time; }
      if (!n.author && p.author) n.author = p.author;
      if (!n.image && p.image) n.image = p.image;
      if (!n.summary && p.summary) n.summary = p.summary;
    }
  }

  // 결정론적 출력: 매시간 실행돼도 실제 데이터가 바뀌지 않으면 파일이 동일 →
  // 워크플로의 "변경 시에만 커밋"이 동작해 불필요한 커밋이 쌓이지 않는다.
  // (시각 의존 필드 generatedAt 등은 의도적으로 제외)
  const reportStable = report.map((r) => ({ name: r.name, ...(r.skipped ? { skipped: r.skipped } : r.error ? { error: r.error } : { added: r.added }) }));
  const data = {
    meta: {
      ...curated.meta,
      updated: iso(TODAY),
      version: curated.meta.version || 1,
      pipeline: reportStable,
      counts: { total: games.length, curated: curated.games.length, collected: collected.length, news: news.length },
    },
    games,
    news,
  };
  delete data.meta.kind;

  const provLine = report.map((r) => r.skipped ? `${r.name}(skip:${r.skipped})` : r.error ? `${r.name}(err:${r.error})` : `${r.name}(+${r.added})`).join("  ");

  // 실제 내용이 바뀐 경우에만 파일을 갱신한다. 시각성 필드(updated)는 비교에서 제외해
  // 변동이 없으면 파일이 그대로 유지되도록 한다(불필요한 커밋 방지).
  const stripVolatile = (o) => { const c = JSON.parse(JSON.stringify(o)); if (c.meta) delete c.meta.updated; return c; };
  const unchanged = prev && JSON.stringify(stripVolatile(prev)) === JSON.stringify(stripVolatile(data));
  if (unchanged) {
    console.log("providers:", provLine);
    console.log(`변경 없음 — games.json 유지 (${games.length} games)`);
    return;
  }

  await writeFile(outPath, JSON.stringify(data, null, 2) + "\n");
  console.log("providers:", provLine);
  console.log(`games.json written: ${games.length} games (curated ${curated.games.length} + collected ${collected.length}, deduped)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
