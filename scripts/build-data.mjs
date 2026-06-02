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
    status: new Date(date) < TODAY ? "released" : "upcoming",
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
  s = s.replace(/['"‘’“”]/g, " ");    // 따옴표 제거
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
async function fromInven(out) {
  if (process.env.INVEN !== "1") return { name: "Inven", skipped: "INVEN!=1" };
  let html = "", status = 0, err = "";
  if (process.env.INVEN_HTML_FILE) {            // 테스트 훅: 로컬 HTML 픽스처로 파서 검증
    try { html = readFileSync(process.env.INVEN_HTML_FILE, "utf8"); status = 200; }
    catch (e) { err = String(e && e.message || e); }
  } else {
    try {
      const res = await fetch(INVEN_CAL.url, { headers: HEADERS });
      status = res.status;
      html = await res.text();
    } catch (e) { err = String(e && e.message || e); }
  }

  // 진단 파일: 러너가 인벤으로부터 실제로 받은 것을 저장소에 남겨 구조/도달성 확인.
  try {
    const dbg = [
      `fetched_at=${new Date().toISOString()}`,
      `url=${INVEN_CAL.url}`,
      `status=${status}`,
      `error=${err}`,
      `html_length=${html.length}`,
      `calendar_game_links=${(html.match(/\/webzine\/calendar\/game\/\d+/g) || []).length}`,
      `news_links=${(html.match(/\/webzine\/news\/\?news=\d+/g) || []).length}`,
      `upload_imgs=${(html.match(/upload\d*\.inven\.co\.kr\/upload/g) || []).length}`,
      `calendar_items=${(html.match(/<li class="calendar__item/g) || []).length}`,
    ].join("\n");
    await writeFile(join(ROOT, "data/_inven-debug.txt"), dbg + "\n");
  } catch { /* 디버그 기록 실패는 무시 */ }

  if (!html || status >= 400) return { name: "Inven", error: `status=${status} ${err}`.trim(), added: 0 };

  // ── 실제 캘린더 일정 리스트 파싱 (<li class="calendar__item ...">) ────────
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
  const seen = new Set();
  for (const m of html.matchAll(/<li class="calendar__item[\s\S]*?<\/li>/g)) {
    const it = m[0];

    // 제목 (행사형은 .title-text, 출시형은 .calendar__title 직접)
    let title = (it.match(/class="title-text">([\s\S]*?)<\/span>/) || [])[1];
    if (!title) title = (it.match(/class="calendar__title"[^>]*>([\s\S]*?)<\/h3>/) || [])[1];
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
    if (!date) continue;

    const sort = (it.match(/calendar__event-sort">([^<]+)/) || it.match(/calendar__platform-txt">([^<]+)/) || [])[1];
    const eventType = evMap(sort);
    const image = (it.match(/calendar__figure[\s\S]*?<img[^>]+src="([^"]+)"/) || [])[1] || null;
    // 직접 상세 링크: group 앵커 href (출시작은 /webzine/calendar/game/{id}, 행사는 뉴스/공식/영상)
    const atag = (it.match(/<a\b[^>]*calendar__item--group[^>]*>/) || [])[0] || "";
    const detailUrl = abs((atag.match(/href="([^"]+)"/) || [])[1]);
    const idx = (it.match(/data-game-idx="(\d+)"/) || [])[1] || (detailUrl && (detailUrl.match(/\/game\/(\d+)/) || [])[1]);
    const yt = (it.match(/data-youtube="([^"]+)"/) || [])[1];
    const company = stripTags((it.match(/class="calendar__company">([\s\S]*?)<\/(?:p|span)>/) || [])[1]);
    const platforms = [...new Set([...it.matchAll(/calendar__platform-icon--([a-z0-9]+)/g)].map((x) => PLAT[x[1]]).filter(Boolean))];
    const tags = [...it.matchAll(/class="calendar__event-tag">\s*([^<]+?)\s*<\/span>/g)].map((x) => x[1].trim()).filter(Boolean);

    const id = idx ? `inven-${idx}` : `inven-${slug(title)}`;
    if (seen.has(id)) continue;
    seen.add(id);

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
  return { name: "Inven", added };
}

// 루리웹 게임 뉴스 수집. 러너에서만 동작(NEWS=1). 여러 소스를 순회하고 중복 제거.
const RULIWEB_SOURCES = [
  "https://bbs.ruliweb.com/news",            // 데스크톱 뉴스 목록(썸네일+요약+조회수+시각+댓글수)
  "https://bbs.ruliweb.com/news?page=2",     // 추가 페이지(지원 시 더 많은 기사, 미지원이면 ID로 중복 제거)
  "https://bbs.ruliweb.com/news?page=3",
];
// HTML 텍스트/엔티티 정리
const rwText = (s) => (s || "")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ").trim();

// 데스크톱 뉴스의 <section class="center_list"> 리치 목록(썸네일·요약·댓글수·시각·조회수)
function parseRuliwebList(html, news, seen, cap = 60) {
  const start = html.indexOf('class="center_list"');
  const sec = start >= 0 ? html.slice(start) : html;
  let added = 0;
  for (const m of sec.matchAll(/<div id="news_(\d+)"[\s\S]*?(?=<div id="news_\d+"|<\/section>)/g)) {
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
    if (image) { image = image.trim().replace(/^['"]|['"]$/g, ""); if (image.startsWith("//")) image = "https:" + image; }
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
  for (const m of html.matchAll(/<a[^>]+href="([^"]*\/news\/(?:board\/\d+\/)?read\/(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
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
    let n = parseRuliwebList(html, news, seen, 60);      // 리치 목록 우선
    if (n < 5) n += parseRuliweb(html, news, seen, 40);  // 구조 변경 시 캐러셀 폴백
    console.log(`[ruliweb] parsed ${n}`);
    added += n;
  }
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
    .filter((g) => g.releaseDate && !isNaN(new Date(g.releaseDate)))
    .sort((a, b) => new Date(a.releaseDate) - new Date(b.releaseDate));

  // 뉴스: 제목 정규화 기준 중복 제거. 수집 실패/스킵 시 기존 뉴스 유지(로컬 빌드가 지우지 않게).
  const seenNews = new Set();
  let news = [];
  for (const n of newsItems) {
    const k = String(n.title).toLowerCase().replace(/\s+/g, "");
    if (!k || seenNews.has(k)) continue;
    seenNews.add(k); news.push(n);
  }
  if (!news.length && prev && Array.isArray(prev.news)) news = prev.news;

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
