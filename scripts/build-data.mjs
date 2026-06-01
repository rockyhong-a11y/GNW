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
  // 브라우저 유사 헤더(봇 차단 완화)
  const HEADERS = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "ko-KR,ko;q=0.9",
    "referer": "https://www.inven.co.kr/",
  };
  let html = "", status = 0, err = "";
  try {
    const res = await fetch(INVEN_CAL.url, { headers: HEADERS });
    status = res.status;
    html = await res.text();
  } catch (e) { err = String(e && e.message || e); }

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
      `date_tokens=${(html.match(/20\d{2}[-./]\d{1,2}[-./]\d{1,2}/g) || []).slice(0, 12).join(",")}`,
      `--- SAMPLE (from toolbar onward = 실제 일정 리스트, ~90000 chars) ---`,
      (() => {
        const t = html.search(/class="toolbar[ "]/);
        const i = html.search(/\/webzine\/calendar\/game\/\d+/);
        const start = t >= 0 ? t : (i > 800 ? i - 800 : 0);
        return html.slice(start, start + 90000);
      })(),
    ].join("\n");
    await writeFile(join(ROOT, "data/_inven-debug.txt"), dbg);
  } catch { /* 디버그 기록 실패는 무시 */ }

  if (!html || status >= 400) return { name: "Inven", error: `status=${status} ${err}`.trim(), added: 0 };

  // 캘린더 셀의 게임 항목: <a href="...상세...">제목</a> + 인접한 날짜(YYYY-MM-DD / MM.DD)
  // 인벤 캘린더 분류 키워드 → eventType
  const evFromText = (s) =>
    /얼리\s*액세스|early\s*access/i.test(s) ? "ea" :
    /테스트|CBT|OBT|베타/i.test(s) ? "test" :
    /업데이트|패치|시즌|버전/i.test(s) ? "update" :
    /행사|쇼케이스|페스트|페스티벌|컨퍼런스|팝업|대회|기념/.test(s) ? "event" : "release";

  let added = 0;
  const seen = new Set();
  // 상세 페이지 링크 패턴: /webzine/calendar/game/{id}
  const DETAIL = /\/webzine\/calendar\/game\/(\d+)/;
  // 날짜 블록 단위로 끊어 각 블록 내 상세 링크를 그 날짜에 귀속
  const blocks = html.split(/(?=(?:20\d{2}[-./]\d{1,2}[-./]\d{1,2})|(?:\d{1,2}\/\d{1,2}\([월화수목금토일]\)))/);
  for (const b of blocks) {
    let date;
    const dm = b.match(/(20\d{2})[-./](\d{1,2})[-./](\d{1,2})/);
    const km = b.match(/(\d{1,2})\/(\d{1,2})\([월화수목금토일]\)/); // MM/DD(요일)
    if (dm) date = `${dm[1]}-${String(dm[2]).padStart(2, "0")}-${String(dm[3]).padStart(2, "0")}`;
    else if (km) date = `${TODAY.getFullYear()}-${String(km[1]).padStart(2, "0")}-${String(km[2]).padStart(2, "0")}`;
    else continue;

    for (const a of b.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const href = a[1];
      const dt = href.match(DETAIL);
      if (!dt) continue; // 상세 페이지 링크가 있는 항목만 채택
      const id = dt[1];
      if (seen.has(id)) continue;
      seen.add(id);
      const title = a[2].replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, " ").trim();
      if (!title || title.length < 2) continue;
      // 항목 주변에서 인벤 업로드 썸네일 추출(있으면 카드 이미지로 사용)
      const win = b.slice(Math.max(0, a.index - 400), a.index + a[0].length + 400);
      const im = win.match(/<img[^>]+src="(https?:\/\/[^"]*inven\.co\.kr\/upload[^"]+\.(?:jpg|jpeg|png|gif|webp))/i);
      out.push(makeGame({
        id: `inven-${id}`,
        title, titleKr: title,
        platforms: [], genres: [],
        releaseDate: date,
        eventType: evFromText(b.slice(0, 400) + " " + title),
        tags: ["인벤"],
        description: "",
        image: im ? im[1] : null,
        source: INVEN_CAL,
        detailUrl: `https://www.inven.co.kr/webzine/calendar/game/${id}`,   // 인벤 상세 페이지 직접 링크
      }));
      added++;
    }
  }
  return { name: "Inven", added };
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
  const collected = [];
  const report = [];

  // "인벤 주요 일정 정보만 참조" — 현재 활성 provider 는 인벤 캘린더 하나뿐.
  // (fromRAWG/fromSteam/fromRSS 는 함수로 남겨둠: 필요 시 이 배열에 다시 추가)
  for (const provider of [fromInven]) {
    try {
      report.push(await provider(collected));
    } catch (e) {
      report.push({ name: provider.name, error: e.message });
    }
  }

  // 병합: curated 우선. 동일 게임(원제 title 정규화 기준)은 curated 가 덮어씀.
  const byKey = new Map();
  for (const g of collected) byKey.set(normTitle(g.title), g);
  for (const g of curated.games) {
    const hit = byKey.get(normTitle(g.title)); // 같은 게임의 인벤 수집본(있으면)
    if (hit && hit.source && hit.source.name === INVEN_CAL.name) {
      // 번역 등 나머지는 curated 유지하되, 인벤의 "직접 상세 링크"와 "썸네일"로 보강.
      if (hit.detailUrl && /\/webzine\/(calendar\/game|news)\//.test(hit.detailUrl)) g.detailUrl = hit.detailUrl;
      if (!g.image && hit.image) g.image = hit.image;
    }
    if (!g.detailUrl) g.detailUrl = detailFor(g.titleKr || g.title); // 직접 링크 없으면 본 제목 검색으로 폴백
    byKey.set(normTitle(g.title), g); // curated(보강본) wins
  }

  const games = [...byKey.values()]
    .filter((g) => g.releaseDate && !isNaN(new Date(g.releaseDate)))
    .sort((a, b) => new Date(a.releaseDate) - new Date(b.releaseDate));

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
      counts: { total: games.length, curated: curated.games.length, collected: collected.length },
    },
    games,
  };
  delete data.meta.kind;

  const outPath = join(ROOT, "data/games.json");
  const provLine = report.map((r) => r.skipped ? `${r.name}(skip:${r.skipped})` : r.error ? `${r.name}(err:${r.error})` : `${r.name}(+${r.added})`).join("  ");

  // 실제 내용이 바뀐 경우에만 파일을 갱신한다. 시각성 필드(updated)는 비교에서 제외해
  // 변동이 없으면 파일이 그대로 유지되도록 한다(불필요한 커밋 방지).
  let prev = null;
  try { prev = JSON.parse(await readFile(outPath, "utf8")); } catch { /* 최초 생성 */ }
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
