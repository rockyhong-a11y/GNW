/* GNW — Game New Watch
 * Vanilla JS, no build step. Reads data/games.json and renders a month-grouped
 * timeline of game releases / updates / events from 인벤 발매 캘린더.
 * UI is intentionally minimal: only a platform filter (모바일 · PC · 콘솔) and a
 * month filter. The same JSON is consumed by the iOS Scriptable widget. */

// 인벤 발매 캘린더의 실제 분류와 일치 (카드 배지)
const EVENT_META = {
  release: { label: "출시", color: "#3ddc84" },
  update:  { label: "업데이트", color: "#00c2cb" },
  ea:      { label: "얼리액세스", color: "#6c7aff" },
  test:    { label: "테스트", color: "#ffb454" },
  event:   { label: "행사", color: "#ff85c0" },
};

// 플랫폼을 3개 묶음으로 분류 (모바일 · PC · 콘솔)
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

const STATE = {
  games: [],
  platforms: new Set(),   // empty = all (모바일/PC/콘솔)
  month: "all",           // "all" | "YYYY-MM"
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
function monthShort(key) {
  const [y, m] = key.split("-");
  return `${Number(m)}월`;
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
    if (STATE.platforms.size) {
      const cats = gameCats(g);
      if (![...STATE.platforms].some((c) => cats.has(c))) return false;
    }
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
    <article class="card">
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

function render() {
  const list = applyFilters();
  const root = $("#gameRoot");

  if (!list.length) {
    root.innerHTML = "";
    $("#emptyState").hidden = false;
    $("#resultCount").textContent = "0개";
    return;
  }
  $("#emptyState").hidden = true;
  $("#resultCount").textContent = `${list.length}개`;

  // 월별로 묶어 타임라인으로 표시
  const groups = [];
  const idx = new Map();
  for (const g of list) {
    const k = monthKey(g.releaseDate);
    if (!idx.has(k)) { idx.set(k, groups.length); groups.push({ key: k, items: [] }); }
    groups[idx.get(k)].items.push(g);
  }
  root.className = "timeline";
  root.innerHTML = groups.map((grp) => {
    const isThis = grp.key === `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}`;
    return `
      <section class="month-block">
        <h2 class="month-head ${isThis ? "current" : ""}">
          <span>${monthLabel(grp.key)}</span><span class="month-count">${grp.items.length}</span>
        </h2>
        <div class="game-grid">${grp.items.map(renderCard).join("")}</div>
      </section>`;
  }).join("");
}

/* ---------- Filter chip builders ---------- */
function buildPlatformFilters() {
  const wrap = $("#platformFilters");
  wrap.innerHTML = PLATFORM_CATS
    .map(({ key }) => `<button class="chip ${STATE.platforms.has(key) ? "active" : ""}" data-cat="${key}">${key}</button>`)
    .join("");
  wrap.querySelectorAll(".chip").forEach((c) =>
    c.addEventListener("click", () => {
      const v = c.dataset.cat;
      STATE.platforms.has(v) ? STATE.platforms.delete(v) : STATE.platforms.add(v);
      c.classList.toggle("active");
      render();
    })
  );
}

function buildMonthFilters() {
  const months = [...new Set(STATE.games.map((g) => monthKey(g.releaseDate)))].sort();
  const wrap = $("#monthFilters");
  const chips = [`<button class="chip ${STATE.month === "all" ? "active" : ""}" data-month="all">전체</button>`]
    .concat(months.map((m) => `<button class="chip ${STATE.month === m ? "active" : ""}" data-month="${m}">${monthShort(m)}</button>`));
  wrap.innerHTML = chips.join("");
  wrap.querySelectorAll(".chip").forEach((c) =>
    c.addEventListener("click", () => { STATE.month = c.dataset.month; buildMonthFilters(); render(); })
  );
}

function initFilters() {
  buildPlatformFilters();
  buildMonthFilters();
}

/* ---------- Data loading & refresh ---------- */
let isLoading = false;
let lastFetchAt = 0;

function setRefreshStatus(text, busy) {
  const el = $("#refreshStatus");
  if (el) el.textContent = text;
  const btn = $("#refreshBtn");
  if (btn) { btn.disabled = !!busy; btn.classList.toggle("spinning", !!busy); }
}
function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

async function loadGames(firstLoad = false) {
  if (isLoading) return;
  isLoading = true;
  setRefreshStatus("갱신 중…", true);
  try {
    const res = await fetch(`data/games.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    STATE.games = data.games;
    lastFetchAt = Date.now();
    document.title = data.meta.title;
    $("#lastUpdated").textContent = `데이터 기준 ${data.meta.updated}`;
    renderSources(data.meta);
    initFilters();
    render();
    setRefreshStatus(`갱신 ${nowTime()}`, false);
  } catch (err) {
    setRefreshStatus("갱신 실패", false);
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

function bindRefresh() {
  $("#refreshBtn").addEventListener("click", () => loadGames(false));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastFetchAt > 30000) loadGames(false);
  });
  window.addEventListener("focus", () => { if (Date.now() - lastFetchAt > 30000) loadGames(false); });
}

/* ---------- Init ---------- */
async function init() {
  bindRefresh();
  await loadGames(true);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

init();
