/* GNW — Game New Watch
 * Vanilla JS, no build step. Reads data/games.json and renders a
 * filterable / sortable timeline of game releases, pre-registrations,
 * CBT/OBT tests and major updates. The catalog is reconstructed from the
 * schedules/DBs of 네이버 게임 · 인벤 · 디스이즈게임 · TapTap.
 * The same JSON is consumed by the iOS Scriptable widget. */

// 인벤 발매 캘린더의 실제 분류와 일치
const EVENT_META = {
  release: { label: "출시", color: "#3ddc84" },
  update:  { label: "업데이트", color: "#00c2cb" },
  ea:      { label: "얼리액세스", color: "#6c7aff" },
  test:    { label: "테스트", color: "#ffb454" },
  event:   { label: "행사", color: "#ff85c0" },
};

const STATE = {
  games: [],
  search: "",
  sort: "date-asc",
  view: "timeline",       // timeline | grid
  status: "now",          // now(현재 이후·기본) | upcoming | released | all
  events: new Set(),      // empty = all event types
  platforms: new Set(),   // empty = all
  genres: new Set(),      // empty = all
};

const TODAY = new Date(); // 실제 현재 시각 기준 — 진입 시 "지금"을 기준으로 포커싱
TODAY.setHours(0, 0, 0, 0);
const CUR_MONTH = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}`;

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
function uniqueSorted(items) {
  return [...new Set(items)].sort((a, b) => a.localeCompare(b, "ko"));
}

/* ---------- Filtering & Sorting ---------- */
function applyFilters() {
  const q = STATE.search.trim().toLowerCase();
  let list = STATE.games.filter((g) => {
    if (STATE.status === "now") {
      if (monthKey(g.releaseDate) < CUR_MONTH) return false; // 지난 달 이전은 숨김(현재 이후 포커스)
    } else if (STATE.status === "upcoming" || STATE.status === "released") {
      if (g.status !== STATE.status) return false;
    } // "all" → 전체 표시
    if (STATE.events.size && !STATE.events.has(g.eventType)) return false;
    if (STATE.platforms.size && !g.platforms.some((p) => STATE.platforms.has(p))) return false;
    if (STATE.genres.size && !g.genres.some((gn) => STATE.genres.has(gn))) return false;
    if (q) {
      const haystack = [g.title, g.titleKr, g.developer, g.publisher, g.update, ...(g.tags || []), ...g.genres, ...g.platforms]
        .join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const cmp = {
    "date-asc": (a, b) => new Date(a.releaseDate) - new Date(b.releaseDate),
    "date-desc": (a, b) => new Date(b.releaseDate) - new Date(a.releaseDate),
    "hype-desc": (a, b) => (b.hypeScore || 0) - (a.hypeScore || 0),
    "rating-desc": (a, b) => (b.rating || -1) - (a.rating || -1),
    "price-asc": (a, b) => a.price - b.price,
    "price-desc": (a, b) => b.price - a.price,
    "title-asc": (a, b) => (a.titleKr || a.title).localeCompare(b.titleKr || b.title, "ko"),
  }[STATE.sort];

  return list.sort(cmp);
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

  return `
    <article class="card">
      <div class="card-banner" style="background: linear-gradient(135deg, ${g.color}, ${g.color}55);">
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

  const timelineOK = STATE.view === "timeline" && (STATE.sort === "date-asc" || STATE.sort === "date-desc");
  if (timelineOK) {
    // group by month, preserving the (date-)sorted order
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
  } else {
    root.className = "game-grid flat";
    root.innerHTML = list.map(renderCard).join("");
  }
}

/* ---------- Filter chip builders ---------- */
function buildStatusFilters() {
  const opts = [
    { key: "now", label: "현재 이후" },
    { key: "upcoming", label: "예정" },
    { key: "released", label: "완료" },
    { key: "all", label: "전체 기간" },
  ];
  const wrap = $("#statusFilters");
  wrap.innerHTML = opts
    .map((o) => `<button class="chip ${o.key === STATE.status ? "active" : ""}" data-status="${o.key}">${o.label}</button>`)
    .join("");
  wrap.querySelectorAll(".chip").forEach((c) =>
    c.addEventListener("click", () => { STATE.status = c.dataset.status; buildStatusFilters(); render(); })
  );
}

function buildEventFilters() {
  const wrap = $("#eventFilters");
  wrap.innerHTML = Object.entries(EVENT_META)
    .map(([key, m]) => {
      const active = STATE.events.has(key);
      return `<button class="chip ${active ? "active" : ""}" data-ev="${key}"><span class="dot" style="background:${m.color}"></span>${m.label}</button>`;
    }).join("");
  wrap.querySelectorAll(".chip").forEach((c) =>
    c.addEventListener("click", () => {
      const v = c.dataset.ev;
      STATE.events.has(v) ? STATE.events.delete(v) : STATE.events.add(v);
      c.classList.toggle("active");
      render();
    })
  );
}

function buildToggleFilters(containerId, values, stateSet, colorMap) {
  const wrap = $(containerId);
  wrap.hidden = values.length === 0; // 값이 없으면 필터 그룹 숨김
  wrap.innerHTML = values
    .map((v) => {
      const active = stateSet.has(v);
      const dot = colorMap ? `<span class="dot" style="background:${colorMap[v] || "#6c7aff"}"></span>` : "";
      return `<button class="chip ${active ? "active" : ""}" data-val="${esc(v)}">${dot}${esc(v)}</button>`;
    }).join("");
  wrap.querySelectorAll(".chip").forEach((c) =>
    c.addEventListener("click", () => {
      const v = c.dataset.val;
      stateSet.has(v) ? stateSet.delete(v) : stateSet.add(v);
      c.classList.toggle("active");
      render();
    })
  );
}

function renderHeaderStats() {
  const total = STATE.games.length;
  const upcoming = STATE.games.filter((g) => g.status === "upcoming").length;
  $("#headerStats").innerHTML = `
    <div class="stat"><b>${upcoming}</b><span>예정</span></div>
    <div class="stat"><b>${total}</b><span>전체</span></div>`;
}

/* ---------- Controls ---------- */
function bindControls() {
  let t;
  $("#searchInput").addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => { STATE.search = e.target.value; render(); }, 120);
  });
  $("#sortSelect").addEventListener("change", (e) => { STATE.sort = e.target.value; render(); });

  $("#viewToggle").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      STATE.view = b.dataset.view;
      $("#viewToggle").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
      render();
    })
  );

  $("#resetBtn").addEventListener("click", () => {
    STATE.search = ""; STATE.sort = "date-asc"; STATE.status = "now";
    STATE.events.clear(); STATE.platforms.clear(); STATE.genres.clear();
    $("#searchInput").value = ""; $("#sortSelect").value = "date-asc";
    initFilters();
    render();
  });
}

function initFilters() {
  const platformColors = {
    Mobile: "#f0c419", PC: "#6c7aff", "PS5": "#5b8def", "Xbox Series": "#3ddc84",
    Switch: "#e74c3c", "Switch 2": "#e67e22",
  };
  const platforms = uniqueSorted(STATE.games.flatMap((g) => g.platforms));
  const genres = uniqueSorted(STATE.games.flatMap((g) => g.genres));
  buildStatusFilters();
  buildEventFilters();
  buildToggleFilters("#platformFilters", platforms, STATE.platforms, platformColors);
  buildToggleFilters("#genreFilters", genres, STATE.genres, null);
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
    renderHeaderStats();
    initFilters();
    if (firstLoad) bindControls();
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
