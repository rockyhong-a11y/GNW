/* GNW — Game New Watch
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
const TAB_ORDER = ["all", "모바일", "PC", "콘솔", "news"];

const STATE = {
  games: [],
  news: [],
  platform: "all",   // all | 모바일 | PC | 콘솔 | news
  month: "all",      // all | YYYY-MM
};

const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- Helpers ---------- */
function daysBetween(dateStr) {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  return Math.round((d - TODAY) / 86400000);
}
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}
function monthKey(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(key) {
  const [y, m] = key.split("-");
  const isThis = key === `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}`;
  return `${y}년 ${Number(m)}월${isThis ? " · 이번 달" : ""}`;
}
function countdownLabel(game) {
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
function applyFilters() {
  const list = STATE.games.filter((g) => {
    if (STATE.platform !== "all" && !gameCats(g).has(STATE.platform)) return false;
    if (STATE.month !== "all" && monthKey(g.releaseDate) !== STATE.month) return false;
    return true;
  });
  return list.sort((a, b) => new Date(a.releaseDate) - new Date(b.releaseDate));
}

/* ---------- Rendering ---------- */
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
  // 썸네일 이미지(인벤 리스트처럼). 로드 실패 시 onerror 로 제거해 그라데이션으로 폴백.
  const img = g.image
    ? `<img class="card-img" src="${esc(g.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove();this.closest('.card-banner').classList.remove('has-img')">`
    : "";

  return `
    <article class="card"${g.detailUrl ? ` data-detail="${esc(g.detailUrl)}"` : ""}>
      <div class="card-banner${g.image ? " has-img" : ""}" style="background: linear-gradient(135deg, ${g.color}, ${g.color}55);">
        ${img}
        <span class="event-badge" style="background:${ev.color}">${ev.label}</span>
        <span class="countdown ${cd.released ? "released" : ""}">${cd.text}</span>
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
  const list = STATE.news || [];
  if (!list.length) {
    root.innerHTML = "";
    $("#emptyState").hidden = false;
    return;
  }
  $("#emptyState").hidden = true;
  root.innerHTML = `<ul class="newsboard">` + list.map((n) => `
    <li class="news-item">
      <a href="${esc(n.url)}" target="_blank" rel="noopener">
        ${n.image ? `<img class="news-thumb" src="${esc(n.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
        <span class="news-body">
          <span class="news-title">${esc(n.title)}</span>
          <span class="news-meta">${esc(n.source || "")}${n.date ? " · " + esc(n.date) : ""}</span>
        </span>
      </a>
    </li>`).join("") + `</ul>`;
}

function render() {
  const newsView = STATE.platform === "news";
  $("#monthSelect").style.display = newsView ? "none" : "";
  if (newsView) return renderNews();

  const list = applyFilters();
  const root = $("#gameRoot");

  if (!list.length) {
    root.innerHTML = "";
    $("#emptyState").hidden = false;
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
    return `
      <section class="month-block">
        <h2 class="month-head ${isThis ? "current" : ""}">
          <span>${monthLabel(grp.key)}</span>
        </h2>
        <div class="game-grid">${grp.items.map(renderCard).join("")}</div>
      </section>`;
  }).join("");
}

/* ---------- Platform tabs (bottom bar + swipe) ---------- */
function setTab(cat) {
  if (!TAB_ORDER.includes(cat) || cat === STATE.platform) return;
  STATE.platform = cat;
  document.querySelectorAll("#platformTabs .tab").forEach((t) => {
    const on = t.dataset.cat === cat;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
  });
  render();
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

/* ---------- Month list box ---------- */
function buildMonthSelect() {
  const months = [...new Set(STATE.games.map((g) => monthKey(g.releaseDate)))].sort();
  const sel = $("#monthSelect");
  sel.innerHTML = [`<option value="all">전체 기간</option>`]
    .concat(months.map((m) => `<option value="${m}">${monthLabel(m)}</option>`))
    .join("");
  if (![...sel.options].some((o) => o.value === STATE.month)) STATE.month = "all";
  sel.value = STATE.month;
}

/* ---------- Data loading & refresh ---------- */
let isLoading = false;
let lastFetchAt = 0;

async function loadGames(firstLoad = false) {
  if (isLoading) return;
  isLoading = true;
  try {
    const res = await fetch(`data/games.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    STATE.games = data.games;
    STATE.news = data.news || [];
    lastFetchAt = Date.now();
    document.title = data.meta.title;
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

/* ---------- App icon themes (설정 → 아이콘 변경) ---------- */
const ICON_THEMES = [
  { key: "violet", name: "퍼플", c1: "#6c7aff", c2: "#b14aed" },
  { key: "blue",   name: "블루", c1: "#3aa7ff", c2: "#1e63ff" },
  { key: "green",  name: "그린", c1: "#3ddc84", c2: "#15a85f" },
  { key: "pink",   name: "핑크", c1: "#ff85c0", c2: "#e8458a" },
  { key: "amber",  name: "앰버", c1: "#ffb454", c2: "#ff7a3d" },
  { key: "mono",   name: "다크", c1: "#3a4170", c2: "#1b2036" },
];
function iconSVG(t, size) {
  const id = "g_" + t.key;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.c1}"/><stop offset="1" stop-color="${t.c2}"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="#0d0f1a"/><rect x="36" y="36" width="440" height="440" rx="92" fill="url(#${id})"/><text x="256" y="300" font-family="-apple-system, Segoe UI, Roboto, sans-serif" font-size="150" font-weight="800" fill="#fff" text-anchor="middle" letter-spacing="2">GNW</text><circle cx="256" cy="372" r="13" fill="#3ddc84"/></svg>`;
}
const svgDataUri = (svg) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
function rasterize(svg, size) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = size;
        c.getContext("2d").drawImage(img, 0, 0, size, size);
        resolve(c.toDataURL("image/png"));
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = svgDataUri(svg);
  });
}
function savedIconKey() {
  try { return localStorage.getItem("gnw-icon") || "violet"; } catch { return "violet"; }
}
async function applyIcon(key) {
  const t = ICON_THEMES.find((x) => x.key === key) || ICON_THEMES[0];
  // iOS 홈화면 아이콘은 PNG가 안정적 → canvas로 래스터화한 PNG를 apple-touch-icon 으로
  const png = await rasterize(iconSVG(t, 180), 180);
  if (png) document.querySelectorAll('link[rel="apple-touch-icon"]').forEach((l) => { l.href = png; });
  const fav = document.querySelector('link[rel="icon"]');
  if (fav) fav.href = svgDataUri(iconSVG(t, 64));
  try { localStorage.setItem("gnw-icon", key); } catch {}
}
function buildIconGrid() {
  const cur = savedIconKey();
  const grid = $("#iconGrid");
  grid.innerHTML = ICON_THEMES.map((t) =>
    `<button class="icon-option ${t.key === cur ? "sel" : ""}" type="button" data-key="${t.key}">
       <span class="icon-prev">${iconSVG(t, 60)}</span><span class="icon-name">${t.name}</span>
     </button>`
  ).join("");
  grid.querySelectorAll(".icon-option").forEach((b) =>
    b.addEventListener("click", () => {
      grid.querySelectorAll(".icon-option").forEach((x) => x.classList.remove("sel"));
      b.classList.add("sel");
      applyIcon(b.dataset.key);
    })
  );
}
function bindSettings() {
  const overlay = $("#settingsSheet");
  $("#settingsBtn").addEventListener("click", () => { buildIconGrid(); overlay.hidden = false; });
  $("#settingsClose").addEventListener("click", () => { overlay.hidden = true; });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.hidden = true; });
}

function bindCardClicks() {
  // 카드 전체 클릭 → 상세보기. 단, 링크(▶영상·출처·상세 등)는 자체 동작 유지.
  $("#gameRoot").addEventListener("click", (e) => {
    if (e.target.closest("a, .play-btn")) return;
    const card = e.target.closest(".card[data-detail]");
    if (card && card.dataset.detail) window.open(card.dataset.detail, "_blank", "noopener");
  });
}

/* ---------- Init ---------- */
async function init() {
  bindTabs();
  bindSettings();
  bindCardClicks();
  applyIcon(savedIconKey());
  $("#monthSelect").addEventListener("change", (e) => { STATE.month = e.target.value; render(); });
  bindAutoRefresh();
  await loadGames(true);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

init();
