/* GGG — Good Game, Gallantly
 * Vanilla JS, no build step. Reads data/games.json and renders a month-grouped
 * timeline of game releases / updates / events from 인벤 발매 캘린더.
 * UI: a bottom platform tab bar (전체 · 모바일 · PC · 콘솔, swipeable) and a
 * month list box. The same JSON is consumed by the iOS Scriptable widget. */

// 인벤 발매 캘린더의 실제 분류와 일치 (카드 배지)
const EVENT_META = {
  release: { label: "출시", color: "#3ddc84" },
  update:  { label: "업데이트", color: "#00c2cb" },
  ea:      { label: "얼리액세스", color: "#6c7aff" },
  test:    { label: "테스트", color: "#ffb454" },
  event:   { label: "행사", color: "#ff85c0" },
};

// 플랫폼을 묶음으로 분류 (모바일 · PC · 콘솔)
const PLATFORM_CATS = [
  { key: "모바일", match: (p) => /mobile|android|ios|aos|모바일/i.test(p) },
  { key: "PC", match: (p) => /^pc$|windows|mac|linux|steam|pc/i.test(p) },
  { key: "콘솔", match: (p) => /ps5|ps4|playstation|xbox|switch|nintendo|닌텐도|콘솔/i.test(p) },
];
const gameCats = (g) => {
  const cats = new Set();
  for (const p of (g.platforms || [])) for (const c of PLATFORM_CATS) if (c.match(p)) cats.add(c.key);
  return cats;
};
const TAB_ORDER = ["news", "release", "event"];

const STATE = {
  games: [],
  news: [],
  platform: "news",   // 콘솔 | PC | 모바일 | event | news (실행 시 기본=뉴스)
  month: "all",      // all | YYYY-MM
};
const EVENT_TYPES = ["update", "event", "test"]; // 이벤트 탭에 표시할 종류

const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);
const CUR_MONTH = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}`; // 출시·이벤트 기본 월

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- Helpers ---------- */
function daysBetween(dateStr) {
  if (!dateStr || dateStr === "TBD") return null;
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  return Math.round((d - TODAY) / 86400000);
}
function formatDate(dateStr) {
  if (!dateStr || dateStr === "TBD") return "미정";
  const d = new Date(dateStr);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}
function monthKey(dateStr) {
  if (!dateStr || dateStr === "TBD") return "TBD";
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(key) {
  if (key === "TBD") return "출시 미정";
  const [y, m] = key.split("-");
  const isThis = key === `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}`;
  return `${y}년 ${Number(m)}월${isThis ? " · 이번 달" : ""}`;
}
function countdownLabel(game) {
  if (!game.releaseDate || game.releaseDate === "TBD") return { text: "미정", released: false, tbd: true };
  const days = daysBetween(game.releaseDate);
  if (game.status === "released" || days < 0) return { text: "완료", released: true };
  if (days === 0) return { text: "오늘!", released: false };
  return { text: `D-${days}`, released: false };
}
function formatPrice(price) {
  if (price == null) return { text: "", free: false };
  if (price === 0) return { text: "무료(F2P)", free: true };
  return { text: `₩${price.toLocaleString("ko-KR")}`, free: false };
}

/* ---------- Filtering ---------- */
const newsMonthKey = (d) => String(d || "").replace(/\./g, "-").slice(0, 7); // "2026.06.01" → "2026-06"
const isBoardNews = (n) => /\/board\/\d+\/read\//.test((n && n.url) || ""); // 루리웹 콘솔 정보 게시판 글
// 뉴스 정렬용 타임스탬프(날짜+시각). 없으면 0 → 맨 아래로.
function newsRecency(n) {
  if (!n || !n.date) return 0;
  const p = String(n.date).split(".");
  if (p.length < 3) return 0;
  return new Date(`${p[0]}-${p[1]}-${p[2]}T${n.time || "00:00"}`).getTime() || 0;
}

function applyFilters() {
  const list = STATE.games.filter((g) => {
    if (STATE.platform === "event") {
      if (!EVENT_TYPES.includes(g.eventType)) return false;          // 이벤트 탭: 업데이트·행사·테스트
    } else {
      if (EVENT_TYPES.includes(g.eventType)) return false;           // 출시 탭: 콘솔/PC/모바일 통합(게임당 1건), 이벤트 제외
    }
    if (STATE.month === "TBD") return !g.releaseDate || g.releaseDate === "TBD";  // 미정 필터
    if (STATE.month !== "all" && monthKey(g.releaseDate) !== STATE.month) return false;
    return true;
  });
  return list.sort((a, b) => {
    // TBD 항목은 항상 맨 뒤
    if ((!a.releaseDate || a.releaseDate === "TBD") && (!b.releaseDate || b.releaseDate === "TBD")) return 0;
    if (!a.releaseDate || a.releaseDate === "TBD") return 1;
    if (!b.releaseDate || b.releaseDate === "TBD") return -1;
    return new Date(a.releaseDate) - new Date(b.releaseDate);
  });
}

/* ---------- Rendering ---------- */
function scrollToToday() {
  // 오늘 이상(오늘·미래)의 첫 카드를 화면 최상단으로 → 지난 카드는 위로 스크롤해야 보임
  const ctrl = document.querySelector(".controls");
  const offset = ctrl ? ctrl.getBoundingClientRect().height : 0; // sticky 상단 바 높이만큼 보정
  const scrollTo = (el) => {
    const y = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: Math.max(0, y), behavior: "instant" });
  };
  for (const card of document.querySelectorAll(".card")) {
    const g = STATE.games.find((x) => String(x.id) === card.dataset.gid);
    if (g && daysBetween(g.releaseDate) >= 0) { scrollTo(card); return; }
  }
  // 모두 지난 일정이면 현재 월 블록으로
  const cur = document.querySelector(".month-head.current");
  if (cur) scrollTo(cur.closest(".month-block") || cur);
}

function renderCard(g) {
  const cd = countdownLabel(g);
  const price = formatPrice(g.price);
  const ev = EVENT_META[g.eventType] || { label: g.eventType, color: "#6c7aff" };
  const platforms = g.platforms.map((p) => `<span class="badge platform">${esc(p)}</span>`).join("");
  const genres = g.genres.map((gn) => `<span class="badge">${esc(gn)}</span>`).join("");
  const trailerBtn = g.trailer
    ? `<a class="play-btn" href="${esc(g.trailer)}" target="_blank" rel="noopener" title="소개 영상 보기" aria-label="${esc(g.titleKr || g.title)} 소개 영상 보기">▶</a>`
    : "";
  const source = g.source
    ? `<a class="source" href="${esc(g.source.url)}" target="_blank" rel="noopener">출처 · ${esc(g.source.name)}</a>`
    : "";
  const detail = g.detailUrl
    ? `<a class="detail" href="${esc(g.detailUrl)}" target="_blank" rel="noopener">상세정보 ↗</a>`
    : "";
  // 인벤 게임 이미지(대부분 /gamelogo/ 경로). 깨진 이미지는 onerror 로 그라디언트 폴백.
  const cardImgUrl = g.image || null;
  const img = cardImgUrl
    ? `<img class="card-img" src="${esc(cardImgUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove();this.closest('.card-banner').classList.remove('has-img')">`
    : "";

  return `
    <article class="card" data-gid="${esc(g.id)}">
      <div class="card-banner${cardImgUrl ? " has-img" : ""}" style="background: linear-gradient(135deg, ${g.color}, ${g.color}55);">
        ${img}
        <span class="event-badge" style="background:${ev.color}">${ev.label}</span>
        <span class="countdown ${cd.tbd ? "tbd" : cd.released ? "released" : ""}">${cd.text}</span>
        ${trailerBtn}
      </div>
      <div class="card-body">
        <div>
          <h3 class="card-title">${esc(g.titleKr || g.title)}</h3>
          ${g.title && g.title !== (g.titleKr || g.title) || g.developer
            ? `<p class="card-orig">${esc([g.title !== g.titleKr ? g.title : "", g.developer].filter(Boolean).join(" · "))}</p>`
            : ""}
        </div>
        ${g.update ? `<p class="card-update">📌 ${esc(g.update)}</p>` : ""}
        ${g.description ? `<p class="card-desc">${esc(g.description)}</p>` : ""}
        ${(platforms || genres) ? `<div class="badges">${platforms}${genres}</div>` : ""}
        ${(g.tags && g.tags.length) ? `<div class="badges">${g.tags.map((t) => `<span class="badge tag">#${esc(t)}</span>`).join("")}</div>` : ""}
        <div class="card-meta">
          <span class="meta-date">${formatDate(g.releaseDate)}${g.endDate ? ` ~ ${formatDate(g.endDate).slice(5)}` : ""}</span>
          <span class="meta-right">
            ${g.rating ? `<span class="rating">★ ${g.rating.toFixed(1)}</span>` : (g.hypeScore ? `<span class="hype">🔥 ${g.hypeScore}</span>` : "")}
            ${price.text ? `<span class="price ${price.free ? "free" : ""}">${price.text}</span>` : ""}
          </span>
        </div>
        <div class="card-foot">${source}${detail}</div>
      </div>
    </article>`;
}

function renderNews() {
  const root = $("#gameRoot");
  let list = STATE.news || [];
  if (STATE.month !== "all") list = list.filter((n) => n.date && newsMonthKey(n.date) === STATE.month);
  // 콘솔 정보 게시판(루리웹 board) 글을 최상단으로, 그 안에서 날짜+시각 최신순
  list = [...list].sort((a, b) => {
    const ba = isBoardNews(a) ? 0 : 1, bb = isBoardNews(b) ? 0 : 1;
    if (ba !== bb) return ba - bb;
    return newsRecency(b) - newsRecency(a);
  });
  if (!list.length) {
    root.innerHTML = "";
    $("#emptyState").hidden = false;
    return;
  }
  $("#emptyState").hidden = true;
  STATE._newsView = list; // 클릭 시 인덱스로 참조
  root.innerHTML = `<ul class="newsboard">` + list.map((n, i) => {
    const dt = [n.date, n.time ? `(${n.time})` : ""].filter(Boolean).join(" ");
    const meta = [
      n.comments != null ? `<span class="news-cmt">[${n.comments}]</span>` : "",
      dt ? `<span>${esc(dt)}</span>` : "",
      n.views != null ? `<span>조회 ${Number(n.views).toLocaleString()}</span>` : "",
    ].filter(Boolean).join("");
    return `
    <li class="news-item" data-ni="${i}">
      ${n.image ? `<img class="news-thumb" src="${esc(n.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.removeAttribute('src');this.classList.add('news-thumb--ph')">` : `<span class="news-thumb news-thumb--ph" aria-hidden="true"></span>`}
      <span class="news-body">
        <span class="news-title">${esc(n.title)}</span>
        ${n.summary ? `<span class="news-desc">${esc(n.summary)}</span>` : ""}
        ${meta ? `<span class="news-meta">${meta}</span>` : ""}
      </span>
    </li>`;
  }).join("") + `</ul>`;
}

function render() {
  if (STATE.platform === "news") return renderNews();

  const list = applyFilters();
  const root = $("#gameRoot");

  if (!list.length) {
    root.innerHTML = "";
    $("#emptyState").hidden = false;
    scrollAfterRender = false;
    return;
  }
  $("#emptyState").hidden = true;

  // 월별로 묶어 타임라인으로 표시
  const groups = [];
  const idx = new Map();
  for (const g of list) {
    const k = monthKey(g.releaseDate);
    if (!idx.has(k)) { idx.set(k, groups.length); groups.push({ key: k, items: [] }); }
    groups[idx.get(k)].items.push(g);
  }
  root.innerHTML = groups.map((grp) => {
    const isThis = grp.key === `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}`;
    const isTbd = grp.key === "TBD";
    return `
      <section class="month-block">
        <h2 class="month-head ${isThis ? "current" : ""} ${isTbd ? "tbd" : ""}">
          <span>${monthLabel(grp.key)}</span>
        </h2>
        <div class="game-grid">${grp.items.map(renderCard).join("")}</div>
      </section>`;
  }).join("");
  if (scrollAfterRender) { scrollAfterRender = false; requestAnimationFrame(scrollToToday); }
}

/* ---------- Platform tabs (bottom bar + swipe) ---------- */
function setTab(cat) {
  if (!TAB_ORDER.includes(cat)) return;
  if (cat !== STATE.platform) {            // 탭 전환
    STATE.platform = cat;
    document.querySelectorAll("#platformTabs .tab").forEach((t) => {
      const on = t.dataset.cat === cat;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    // 뉴스=전체 기간(날짜순), 출시·이벤트=현재 월 기준이 디폴트
    STATE.month = cat === "news" ? "all" : CUR_MONTH;
    buildMonthSelect();   // 탭별로 기간 옵션이 다름(뉴스=뉴스 날짜, 그 외=일정 월)
    scrollAfterRender = (cat !== "news"); // 출시·이벤트 탭 전환 시 오늘 기준으로 포커싱
    render();
    // 탭 전환 시 이전 탭의 스크롤 위치가 남아 어색하게 보이지 않도록 초기화.
    // 뉴스=최상단, 출시·이벤트=scrollToToday(오늘 기준)로 위치 잡음.
    if (cat === "news") requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "instant" }));
  }
  // 뉴스 탭은 진입/재탭(이미 활성이어도) 시 최신 뉴스로 갱신
  if (cat === "news" && Date.now() - lastFetchAt > 2000) loadGames(false);
}

function bindTabs() {
  document.querySelectorAll("#platformTabs .tab").forEach((t) =>
    t.addEventListener("click", () => setTab(t.dataset.cat))
  );
  // 콘텐츠 좌우 스와이프로 탭 전환
  const main = document.querySelector("main");
  let x0 = null, y0 = null;
  main.addEventListener("touchstart", (e) => { const t = e.changedTouches[0]; x0 = t.clientX; y0 = t.clientY; }, { passive: true });
  main.addEventListener("touchend", (e) => {
    if (x0 == null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0, dy = t.clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return; // 수평 스와이프만
    const i = TAB_ORDER.indexOf(STATE.platform);
    const ni = dx < 0 ? Math.min(TAB_ORDER.length - 1, i + 1) : Math.max(0, i - 1);
    if (ni !== i) setTab(TAB_ORDER[ni]);
  }, { passive: true });
}

/* ---------- 기간 리스트박스 (탭별) ---------- */
function buildMonthSelect() {
  const sel = $("#monthSelect");
  let months;
  if (STATE.platform === "news") {
    months = [...new Set((STATE.news || []).map((n) => n.date).filter(Boolean).map(newsMonthKey))].sort().reverse();
  } else {
    const tabGames = STATE.games.filter((g) => STATE.platform === "event" ? EVENT_TYPES.includes(g.eventType) : !EVENT_TYPES.includes(g.eventType));
    const hasTbd = tabGames.some((g) => !g.releaseDate || g.releaseDate === "TBD");
    months = [...new Set(tabGames.filter((g) => g.releaseDate && g.releaseDate !== "TBD").map((g) => monthKey(g.releaseDate)))].sort();
    if (hasTbd) months.push("TBD"); // "출시 미정" 옵션을 맨 뒤에 추가
  }
  sel.innerHTML = [`<option value="all">전체 기간</option>`]
    .concat(months.map((m) => `<option value="${m}">${monthLabel(m)}</option>`))
    .join("");
  if (![...sel.options].some((o) => o.value === STATE.month)) STATE.month = "all";
  sel.value = STATE.month;
}

/* ---------- Data loading & refresh ---------- */
let isLoading = false;
let lastFetchAt = 0;
let scrollAfterRender = false;

async function loadGames(firstLoad = false) {
  if (isLoading) return;
  isLoading = true;
  try {
    const res = await fetch(`data/games.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error("응답이 JSON이 아님(네트워크/캐시 문제)"); } // HTML 폴백 등으로 인한 파싱 실패 방지
    STATE.games = data.games;
    STATE.news = data.news || [];
    lastFetchAt = Date.now();
    $("#lastUpdated").textContent = `데이터 기준 ${data.meta.updated}`;
    renderSources(data.meta);
    buildMonthSelect();
    render();
  } catch (err) {
    if (firstLoad && !STATE.games.length) {
      $("#gameRoot").innerHTML = `<p class="empty-state">데이터를 불러오지 못했습니다.<br><small>${esc(err.message)}</small></p>`;
    }
  } finally {
    isLoading = false;
  }
}

function renderSources(meta) {
  if (!$("#sources")) return;
  const links = (meta.sources || [])
    .map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>`)
    .join(" · ");
  const c = meta.counts;
  const prov = c
    ? `<span class="prov">자동 수집 ${c.collected ?? 0} + 큐레이션 ${c.curated ?? 0} → 총 ${c.total ?? STATE.games.length}건</span>`
    : "";
  $("#sources").innerHTML = (links ? "참조: " + links : "") + (prov ? `<br>${prov}` : "");
}

function bindAutoRefresh() {
  // 진입/복귀 시 자동 재요청 (network-first)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastFetchAt > 30000) loadGames(false);
  });
  window.addEventListener("focus", () => { if (Date.now() - lastFetchAt > 30000) loadGames(false); });
}

/* ---------- 당겨서 새로고침 (iOS 스타일) ---------- */
function bindPullToRefresh() {
  const ind = document.createElement("div");
  ind.className = "ptr";
  ind.innerHTML = `<span class="ptr-spinner"></span>`;
  document.body.appendChild(ind);
  const spinner = ind.querySelector(".ptr-spinner");
  const TRIGGER = 64, MAX = 96;
  let startY = 0, pulling = false, dist = 0;

  const reset = () => { ind.classList.remove("show", "ready"); ind.style.transform = ""; };
  const detailOpen = () => { const d = $("#detailSheet"); return d && !d.hidden; };

  document.addEventListener("touchstart", (e) => {
    pulling = false;
    if (window.scrollY > 0 || detailOpen() || isLoading) return;
    if (e.touches.length !== 1) return;
    startY = e.touches[0].clientY; pulling = true; dist = 0;
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (!pulling) return;
    dist = e.touches[0].clientY - startY;
    if (dist <= 0 || window.scrollY > 0) { reset(); pulling = false; return; }
    const pull = Math.min(MAX, dist * 0.5);
    ind.style.transform = `translateY(${pull}px)`;
    ind.classList.add("show");
    ind.classList.toggle("ready", pull >= TRIGGER * 0.5);
    if (e.cancelable && dist > 8) e.preventDefault(); // 우리가 당김을 맡으면 네이티브 바운스 억제
  }, { passive: false });

  document.addEventListener("touchend", async () => {
    if (!pulling) return;
    pulling = false;
    const fire = ind.classList.contains("ready");
    if (!fire) { reset(); return; }
    ind.classList.remove("ready");
    ind.classList.add("show");
    ind.style.transform = "translateY(54px)";
    spinner.classList.add("spin");
    try { await loadGames(false); } finally {
      spinner.classList.remove("spin");
      reset();
    }
  }, { passive: true });
}

/* ---------- App icon presets (설정 → 아이콘 변경) ---------- */
const _svg = (s) => `data:image/svg+xml,${encodeURIComponent(s)}`;
const ICON_PRESETS = [
  { key: "gamepad", name: "컨트롤러", src: _svg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='#0f1123'/><path d='M17 50c0-12 8-20 20-20h26c12 0 20 8 20 20v4l-5 18c-2 6-8 8-13 4l-4-7H39l-4 7c-5 4-11 2-13-4L17 54z' fill='#6c7aff'/><rect x='27' y='45' width='5' height='14' rx='2.5' fill='#fff'/><rect x='22' y='50' width='14' height='5' rx='2.5' fill='#fff'/><circle cx='64' cy='47' r='4' fill='#ff85c0'/><circle cx='72' cy='55' r='4' fill='#3ddc84'/><circle cx='56' cy='55' r='4' fill='#ffb454'/><circle cx='64' cy='63' r='4' fill='#00c2cb'/></svg>`) },
  { key: "trophy",  name: "트로피",   src: _svg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='#0f1123'/><path d='M33 18h34v26c0 15-11 26-17 26s-17-11-17-26V18z' fill='#ffcc00'/><path d='M19 21h14v14c-4 0-14-4-14-14z' fill='#ffcc00'/><path d='M67 21h14c0 10-10 14-14 14V21z' fill='#ffcc00'/><path d='M44 68c0-6 12-6 12 0' fill='none' stroke='#ffcc00' stroke-width='5' stroke-linecap='round'/><rect x='35' y='72' width='30' height='8' rx='4' fill='#ffcc00'/><path d='M42 34c2 4 14 4 16 0' fill='none' stroke='#cc9900' stroke-width='2.5' stroke-linecap='round'/></svg>`) },
  { key: "gem",     name: "보석",     src: _svg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='#0f1123'/><polygon points='50,16 72,37 62,82 38,82 28,37' fill='#00bcd4'/><polygon points='50,16 72,37 50,50 28,37' fill='#80deea'/><polygon points='28,37 50,50 38,82' fill='#0097a7'/><polygon points='72,37 62,82 50,50' fill='#0097a7'/><polygon points='38,82 50,50 62,82' fill='#006064'/></svg>`) },
  { key: "sword",   name: "검",       src: _svg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='#0f1123'/><g transform='rotate(45 50 50)'><rect x='47' y='12' width='6' height='44' rx='3' fill='#c8ccd8'/><rect x='46' y='11' width='8' height='7' rx='2' fill='#edf0f8'/><rect x='28' y='46' width='44' height='8' rx='4' fill='#ffcc00'/><rect x='47' y='56' width='6' height='14' rx='3' fill='#aa8800'/><circle cx='50' cy='75' r='5.5' fill='#ff85c0'/></g></svg>`) },
  { key: "dice",    name: "주사위",   src: _svg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='#0f1123'/><rect x='18' y='18' width='64' height='64' rx='14' fill='#6c7aff'/><circle cx='34' cy='34' r='5.5' fill='#fff'/><circle cx='66' cy='34' r='5.5' fill='#fff'/><circle cx='50' cy='50' r='5.5' fill='#fff'/><circle cx='34' cy='66' r='5.5' fill='#fff'/><circle cx='66' cy='66' r='5.5' fill='#fff'/></svg>`) },
];
function savedIconKey() {
  try { return localStorage.getItem("gnw-icon") || "gamepad"; } catch { return "gamepad"; }
}
function setIconLinks(href) {
  document.querySelectorAll('link[rel="apple-touch-icon"]').forEach((l) => { l.href = href; });
  const fav = document.querySelector('link[rel="icon"]');
  if (fav) fav.href = href;
}
function customIconData() { try { return localStorage.getItem("gnw-icon-custom"); } catch { return null; } }

function applyIcon(key) {
  if (key === "custom") {
    const png = customIconData();
    if (png) { setIconLinks(png); try { localStorage.setItem("gnw-icon", "custom"); } catch {} return; }
    key = "sword";
  }
  const p = ICON_PRESETS.find((x) => x.key === key) || ICON_PRESETS[0];
  setIconLinks(p.src); // 캐릭터 PNG를 홈화면/탭 아이콘으로
  try { localStorage.setItem("gnw-icon", p.key); } catch {}
}

/* ---------- Custom icon: upload + crop ---------- */
let cropState = null;
function drawCrop() {
  const c = cropState; if (!c) return;
  const ctx = c.canvas.getContext("2d");
  const s = c.baseScale * c.scale;
  const w = c.img.width * s, h = c.img.height * s;
  c.x = Math.min(0, Math.max(c.size - w, c.x));   // 이미지가 정사각형을 항상 덮도록 클램프
  c.y = Math.min(0, Math.max(c.size - h, c.y));
  ctx.clearRect(0, 0, c.size, c.size);
  ctx.drawImage(c.img, c.x, c.y, w, h);
}
function openCropper(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const canvas = $("#cropCanvas");
      const size = canvas.width; // 264
      const baseScale = Math.max(size / img.width, size / img.height);
      const w = img.width * baseScale, h = img.height * baseScale;
      cropState = { img, size, scale: 1, baseScale, canvas, x: (size - w) / 2, y: (size - h) / 2 };
      $("#cropZoom").value = "1";
      drawCrop();
      $("#cropModal").hidden = false;
    };
    img.onerror = () => alert("이미지를 불러올 수 없습니다.");
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}
function applyCrop() {
  const c = cropState; if (!c) return;
  const out = 180, r = out / c.size, s = c.baseScale * c.scale;
  const cv = document.createElement("canvas"); cv.width = cv.height = out;
  cv.getContext("2d").drawImage(c.img, c.x * r, c.y * r, c.img.width * s * r, c.img.height * s * r);
  let png; try { png = cv.toDataURL("image/png"); } catch { png = null; }
  if (!png) return;
  try { localStorage.setItem("gnw-icon-custom", png); localStorage.setItem("gnw-icon", "custom"); } catch {}
  setIconLinks(png);
  $("#cropModal").hidden = true;
  $("#settingsSheet").hidden = true;
}
function bindCropper() {
  const canvas = $("#cropCanvas");
  let dragging = false, px = 0, py = 0;
  const down = (e) => { dragging = true; const p = e.touches ? e.touches[0] : e; px = p.clientX; py = p.clientY; };
  const move = (e) => {
    if (!dragging || !cropState) return;
    const p = e.touches ? e.touches[0] : e;
    cropState.x += p.clientX - px; cropState.y += p.clientY - py;
    px = p.clientX; py = p.clientY; drawCrop();
    if (e.cancelable) e.preventDefault();
  };
  const up = () => { dragging = false; };
  canvas.addEventListener("mousedown", down); window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  canvas.addEventListener("touchstart", down, { passive: true });
  canvas.addEventListener("touchmove", move, { passive: false });
  canvas.addEventListener("touchend", up);
  $("#cropZoom").addEventListener("input", (e) => { if (cropState) { cropState.scale = parseFloat(e.target.value); drawCrop(); } });
  $("#cropApply").addEventListener("click", applyCrop);
  $("#cropClose").addEventListener("click", () => { $("#cropModal").hidden = true; });
  $("#cropModal").addEventListener("click", (e) => { if (e.target.id === "cropModal") $("#cropModal").hidden = true; });
}
function buildIconGrid() {
  const cur = savedIconKey();
  const grid = $("#iconGrid");
  let html = ICON_PRESETS.map((t) =>
    `<button class="icon-option ${t.key === cur ? "sel" : ""}" type="button" data-key="${t.key}">
       <span class="icon-prev"><img src="${t.src}" alt="" loading="lazy"></span><span class="icon-name">${t.name}</span>
     </button>`
  ).join("");
  const custom = customIconData();
  if (custom) {
    html += `<button class="icon-option ${cur === "custom" ? "sel" : ""}" type="button" data-key="custom">
       <span class="icon-prev"><img src="${custom}" alt=""></span><span class="icon-name">내 사진</span>
     </button>`;
  }
  grid.innerHTML = html;
  grid.querySelectorAll(".icon-option").forEach((b) =>
    b.addEventListener("click", () => {
      grid.querySelectorAll(".icon-option").forEach((x) => x.classList.remove("sel"));
      b.classList.add("sel");
      applyIcon(b.dataset.key);
    })
  );
}
/* ---------- Theme (다크/라이트 토글) ---------- */
const THEME_COLOR = { dark: "#0d0f1a", light: "#eef1f8" };
function savedTheme() {
  try { return localStorage.getItem("gnw-theme") === "light" ? "light" : "dark"; } catch { return "dark"; }
}
function applyTheme(theme) {
  const t = theme === "light" ? "light" : "dark";
  if (t === "light") document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem("gnw-theme", t); } catch {}
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = THEME_COLOR[t];
  // 토글 버튼 선택 상태 동기화
  document.querySelectorAll(".theme-opt").forEach((b) => {
    const on = b.dataset.theme === t;
    b.classList.toggle("sel", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
}
function bindTheme() {
  document.querySelectorAll(".theme-opt").forEach((b) =>
    b.addEventListener("click", () => applyTheme(b.dataset.theme))
  );
  applyTheme(savedTheme());
}

function bindSettings() {
  const overlay = $("#settingsSheet");
  $("#settingsBtn").addEventListener("click", () => { buildIconGrid(); overlay.hidden = false; });
  $("#settingsClose").addEventListener("click", () => { overlay.hidden = true; });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.hidden = true; });
  $("#iconUploadBtn").addEventListener("click", () => $("#iconFile").click());
  $("#iconFile").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) openCropper(f);
    e.target.value = "";
  });
  bindCropper();
}

function bindCardClicks() {
  // 출시·이벤트 카드·뉴스 모두 앱 내 다크 미리보기로. (카드 안 링크/▶영상은 자체 동작)
  $("#gameRoot").addEventListener("click", (e) => {
    if (e.target.closest("a, .play-btn")) return;
    const card = e.target.closest(".card[data-gid]");
    if (card) {
      const g = STATE.games.find((x) => String(x.id) === card.dataset.gid);
      if (g) openGameDetail(g);
      return;
    }
    const ni = e.target.closest(".news-item[data-ni]");
    if (ni && STATE._newsView) {
      const n = STATE._newsView[+ni.dataset.ni];
      if (n) openDetail(n);
    }
  });
}

/* ---------- 출시·이벤트 미리보기 (앱 내 다크 뷰) ---------- */
function ytIdFrom(url) {
  if (!url) return null;
  const m = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=))([A-Za-z0-9_-]{8,})/i);
  return m ? m[1] : null;
}
function setDetailOrigBtn(url) {
  const btn = $("#detailOrigBtn");
  if (!btn) return;
  if (url) { btn.href = url; btn.hidden = false; }
  else btn.hidden = true;
}

// 상세 본문 블록 렌더(뉴스·게임 미리보기 공용): 단락/이미지/유튜브를 원문 순서대로.
const detailYtEmbed = (id) => `<div class="detail-video"><iframe src="https://www.youtube.com/embed/${esc(id)}" title="YouTube" loading="lazy" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`;
const detailPara = (b) => b.seg
  ? `<p>${b.seg.map((s) => s.t === "a" ? `<a class="detail-link" href="${esc(s.v)}" target="_blank" rel="noopener">${esc(s.l)}</a>` : esc(s.v)).join("")}</p>`
  : `<p>${esc(b.v || "")}</p>`;
function renderContentBlocks(content) {
  const seen = new Set();
  return (content || []).map((b) => {
    if (b.t === "yt") return detailYtEmbed(b.v);
    if (b.t === "img") {
      if (seen.has(b.v)) return "";
      seen.add(b.v);
      return `<img class="detail-img" src="${esc(b.v)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`;
    }
    return detailPara(b);
  }).join("");
}

function openGameDetail(g) {
  const ev = EVENT_META[g.eventType] || { label: g.eventType, color: "#6c7aff" };
  const cd = countdownLabel(g);
  const price = formatPrice(g.price);
  const dateStr = `${formatDate(g.releaseDate)}${g.endDate ? ` ~ ${formatDate(g.endDate).slice(5)}` : ""}`;
  const meta = [
    `<span class="dm-author" style="color:${ev.color}">${esc(ev.label)}</span>`,
    `<span>${esc(dateStr)}</span>`,
    `<span class="dm-dday ${cd.released ? "done" : ""}">${esc(cd.text)}</span>`,
    (g.developer && g.developer !== "미상") ? `<span>${esc(g.developer)}</span>` : "",
    price.text ? `<span>${esc(price.text)}</span>` : "",
  ].filter(Boolean).join('<span class="dm-dot">·</span>');

  const ytId = ytIdFrom(g.trailer);

  // 이미지: 게임 로고/스크린샷. 영상만 있을 때는 플레이스홀더 생략.
  const banner = g.image
    ? `<div class="detail-banner"><img src="${esc(g.image)}" alt="" referrerpolicy="no-referrer" onerror="this.closest('.detail-banner').remove()"></div>`
    : (!ytId ? `<div class="detail-banner detail-banner--ph" style="background:linear-gradient(135deg, ${g.color || "#6c7aff"}, ${(g.color || "#6c7aff")}55)"></div>` : "");

  const badge = (arr, cls) => (arr || []).map((x) => `<span class="badge ${cls}">${esc(cls === "tag" ? "#" + x : x)}</span>`).join("");
  const badges = [badge(g.platforms, "platform"), badge(g.genres, ""), badge(g.tags, "tag")].join("");

  // 본문: 상세 페이지에서 수집한 content[](단락·스샷·영상)가 있으면 뉴스처럼 그대로,
  // 없으면 설명/안내 문구로 폴백. 트레일러는 본문에 영상이 없을 때만 끝에 임베드.
  const hasContent = !!(g.content && g.content.length);
  const hasYtBlock = hasContent && g.content.some((b) => b.t === "yt");
  const bodyParts = [];
  if (g.update) bodyParts.push(`<p>📌 ${esc(g.update)}</p>`);
  if (hasContent) {
    bodyParts.push(renderContentBlocks(g.content));
  } else if (g.description) {
    bodyParts.push(`<p>${esc(g.description)}</p>`);
  } else {
    const dev = (g.developer && g.developer !== "미상") ? g.developer : "";
    const line = cd.released
      ? `${dateStr}에 ${ev.label}된 작품입니다.`
      : cd.tbd ? `출시일 미정인 ${ev.label} 예정작입니다.`
      : `${dateStr} ${ev.label} 예정작입니다.`;
    bodyParts.push(`<p>${esc(line)}${dev ? esc(` 개발: ${dev}.`) : ""}</p>`);
  }
  if (ytId && !hasYtBlock) bodyParts.push(detailYtEmbed(ytId));

  // 유튜브가 아닌 트레일러 링크, 출처
  const extraLinks = [
    (!ytId && g.trailer) ? `<a class="dc-more" href="${esc(g.trailer)}" target="_blank" rel="noopener">▶ 트레일러 보기</a>` : "",
    (g.source && g.source.url) ? `<a class="dc-more" href="${esc(g.source.url)}" target="_blank" rel="noopener">출처 · ${esc(g.source.name)} ↗</a>` : "",
  ].filter(Boolean).join("");

  $("#detailBody").innerHTML = `
    <h1 class="detail-title">${esc(g.titleKr || g.title)}</h1>
    ${(g.title && g.title !== (g.titleKr || g.title)) ? `<p class="detail-subtitle">${esc(g.title)}</p>` : ""}
    <div class="detail-meta">${meta}</div>
    ${banner}
    ${badges ? `<div class="detail-badges">${badges}</div>` : ""}
    <div class="detail-article">${bodyParts.join("")}</div>
    ${extraLinks ? `<div class="detail-links">${extraLinks}</div>` : ""}`;

  setDetailOrigBtn(g.detailUrl || (g.source && g.source.url) || null);
  $("#detailSheet").hidden = false;
  document.body.classList.add("sheet-open");
  const sc = $("#detailScroll");
  sc.scrollTop = 0;
  requestAnimationFrame(() => { sc.scrollTop = 0; });
}

/* ---------- 뉴스 상세 (앱 내 다크 뷰) ---------- */
function openDetail(n) {
  const sheet = $("#detailSheet");
  const dt = [n.date, n.time ? `(${n.time})` : ""].filter(Boolean).join(" ");
  const meta = [
    n.author ? `<span class="dm-author">${esc(n.author)}</span>` : "",
    dt ? `<span>${esc(dt)}</span>` : "",
    n.views != null ? `<span>조회 ${Number(n.views).toLocaleString()}</span>` : "",
    n.comments != null ? `<span>댓글 ${n.comments}</span>` : "",
  ].filter(Boolean).join('<span class="dm-dot">·</span>');
  const hasVideo = !!(n.content && n.content.some((b) => b.t === "yt"));
  // 영상 글은 배너(=영상 썸네일)를 생략하고 아래에서 재생 가능한 영상으로 노출
  const banner = (n.image && !hasVideo)
    ? `<div class="detail-banner"><img src="${esc(n.image)}" alt="" referrerpolicy="no-referrer" onerror="this.closest('.detail-banner').remove()"></div>`
    : "";
  let body;
  if (n.content && n.content.length) {
    const hasText = n.content.some((b) => b.t === "p");
    const lead = (!hasText && n.summary) ? `<p>${esc(n.summary)}</p>` : ""; // 영상/이미지만 있는 글은 요약을 앞에
    body = lead + renderContentBlocks(n.content);
  } else if (n.summary) {
    body = `<p>${esc(n.summary)}</p>`;
  } else {
    body = `<p class="detail-empty">본문을 불러오지 못했습니다. 아래 '원문 보기'에서 확인하세요.</p>`;
  }
  // 댓글: 상위 댓글이 있으면 인라인 노출, 없으면 댓글 수 + 원문 링크
  let comments = "";
  if (n.topComments && n.topComments.length) {
    // 베스트 댓글을 위로, 추천수 높은 순
    const cs = [...n.topComments].sort((a, b) => (b.best ? 1 : 0) - (a.best ? 1 : 0) || (b.like || 0) - (a.like || 0));
    comments = `<section class="detail-comments">
        <h2 class="dc-head">댓글${n.comments != null ? ` ${Number(n.comments).toLocaleString()}` : ""}</h2>
        ${cs.map((c) => `<div class="dc-item${c.best ? " best" : ""}">
          <div class="dc-top">${c.best ? `<span class="dc-best">BEST</span>` : ""}${c.nick ? `<span class="dc-nick">${esc(c.nick)}</span>` : ""}${c.like ? `<span class="dc-like">👍 ${c.like}</span>` : ""}</div>
          ${c.text ? `<div class="dc-text">${esc(c.text)}</div>` : ""}
          ${(c.imgs && c.imgs.length) ? `<div class="dc-imgs">${c.imgs.map((u) => `<img src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`).join("")}</div>` : ""}
        </div>`).join("")}
        ${n.url ? `<a class="dc-more" href="${esc(n.url)}" target="_blank" rel="noopener">원문에서 댓글 더 보기 ↗</a>` : ""}
      </section>`;
  } else if (n.comments != null && n.url) {
    comments = `<a class="dc-more dc-only" href="${esc(n.url)}" target="_blank" rel="noopener">💬 댓글 ${Number(n.comments).toLocaleString()}개 · 원문에서 보기 ↗</a>`;
  }
  $("#detailBody").innerHTML = `
    <h1 class="detail-title">${esc(n.title)}</h1>
    <div class="detail-meta">${meta}</div>
    ${banner}
    <div class="detail-article">${body}</div>
    ${comments}`;
  setDetailOrigBtn(n.url || null);
  sheet.hidden = false;
  document.body.classList.add("sheet-open");
  // 항상 글 최상단(제목)부터 보이도록 — 시트를 표시한 뒤 스크롤을 리셋(숨김 상태에선 적용 안 됨).
  const sc = $("#detailScroll");
  sc.scrollTop = 0;
  requestAnimationFrame(() => { sc.scrollTop = 0; });
}
function closeDetail() {
  const sheet = $("#detailSheet");
  sheet.hidden = true;
  sheet.classList.remove("sliding", "closing");
  sheet.style.transform = "";
  document.body.classList.remove("sheet-open");
  setDetailOrigBtn(null);
}
function bindDetail() {
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#detailSheet").hidden) closeDetail(); });
  $("#detailBack").addEventListener("click", closeDetail);
  bindDetailSwipe();
}
// 좌측 가장자리에서 오른쪽으로 슬라이드 → 목록으로 복귀(iOS 인터랙티브 백 제스처)
function bindDetailSwipe() {
  const sheet = $("#detailSheet");
  const W = () => window.innerWidth || 360;
  let x0 = null, y0 = null, active = false;
  sheet.addEventListener("touchstart", (e) => {
    active = false;
    if (sheet.hidden || e.touches.length !== 1) return;
    const t = e.touches[0];
    if (t.clientX > 44) return;            // 좌측 가장자리에서 시작한 제스처만(본문 스크롤과 분리)
    x0 = t.clientX; y0 = t.clientY; active = true;
    sheet.classList.add("sliding"); sheet.classList.remove("closing");
  }, { passive: true });
  sheet.addEventListener("touchmove", (e) => {
    if (!active) return;
    const t = e.touches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) { // 세로 제스처 → 취소
      active = false; sheet.classList.remove("sliding"); sheet.style.transform = ""; return;
    }
    if (dx > 0) { sheet.style.transform = `translateX(${dx}px)`; if (e.cancelable) e.preventDefault(); }
  }, { passive: false });
  sheet.addEventListener("touchend", (e) => {
    if (!active) return;
    active = false;
    const dx = e.changedTouches[0].clientX - x0;
    sheet.classList.remove("sliding"); sheet.classList.add("closing");
    if (dx > W() * 0.32 || dx > 110) {     // 충분히 밀면 닫기(밖으로 슬라이드 후 종료)
      sheet.style.transform = `translateX(${W()}px)`;
      setTimeout(closeDetail, 180);
    } else {
      sheet.style.transform = "";          // 덜 밀면 제자리 복귀
    }
  }, { passive: true });
}

/* ---------- Init ---------- */
async function init() {
  bindTabs();
  bindSettings();
  bindTheme();
  bindCardClicks();
  bindDetail();
  applyIcon(savedIconKey());
  $("#monthSelect").addEventListener("change", (e) => {
    STATE.month = e.target.value; render();
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "instant" })); // 기간 변경 시 최상단부터
  });
  bindAutoRefresh();
  bindPullToRefresh();
  await loadGames(true);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

init();
