/* GNW — Game New Watch
 * Vanilla JS, no build step. Reads data/games.json and renders a
 * filterable / sortable catalog of game releases. The same JSON is
 * consumed by the iOS Scriptable widget (widget/gnw-widget.js). */

const STATE = {
  games: [],
  search: "",
  sort: "date-asc",
  status: "all",       // all | upcoming | released
  platforms: new Set(), // empty = all
  genres: new Set(),    // empty = all
};

const TODAY = new Date("2026-05-31"); // fixed "now" so sample data behaves predictably
TODAY.setHours(0, 0, 0, 0);

const $ = (sel) => document.querySelector(sel);

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

function countdownLabel(game) {
  const days = daysBetween(game.releaseDate);
  if (game.status === "released" || days < 0) return { text: "출시됨", released: true };
  if (days === 0) return { text: "오늘 출시!", released: false };
  if (days <= 30) return { text: `D-${days}`, released: false };
  return { text: `D-${days}`, released: false };
}

function formatPrice(price) {
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
    if (STATE.status !== "all" && g.status !== STATE.status) return false;
    if (STATE.platforms.size && !g.platforms.some((p) => STATE.platforms.has(p))) return false;
    if (STATE.genres.size && !g.genres.some((gn) => STATE.genres.has(gn))) return false;
    if (q) {
      const haystack = [g.title, g.developer, g.publisher, ...(g.tags || []), ...g.genres, ...g.platforms]
        .join(" ")
        .toLowerCase();
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
    "title-asc": (a, b) => a.title.localeCompare(b.title, "ko"),
  }[STATE.sort];

  return list.sort(cmp);
}

/* ---------- Rendering ---------- */
function renderCard(g) {
  const cd = countdownLabel(g);
  const price = formatPrice(g.price);
  const platforms = g.platforms.map((p) => `<span class="badge platform">${p}</span>`).join("");
  const genres = g.genres.map((gn) => `<span class="badge">${gn}</span>`).join("");

  const trailerBtn = g.trailer
    ? `<a class="play-btn" href="${g.trailer}" target="_blank" rel="noopener" title="소개 영상 보기" aria-label="${g.title} 소개 영상 보기">▶</a>`
    : "";

  return `
    <article class="card">
      <div class="card-banner" style="background: linear-gradient(135deg, ${g.color}, ${g.color}55);">
        <span class="countdown ${cd.released ? "released" : ""}">${cd.text}</span>
        ${trailerBtn}
      </div>
      <div class="card-body">
        <div>
          <h3 class="card-title">${g.title}</h3>
          <p class="card-dev">${g.developer}</p>
        </div>
        <p class="card-desc">${g.description}</p>
        <div class="badges">${platforms}${genres}</div>
        <div class="card-meta">
          <span class="meta-date">${formatDate(g.releaseDate)}</span>
          <span class="meta-right">
            ${g.rating ? `<span class="rating">★ ${g.rating.toFixed(1)}</span>` : `<span class="hype">🔥 ${g.hypeScore}</span>`}
            <span class="price ${price.free ? "free" : ""}">${price.text}</span>
          </span>
        </div>
      </div>
    </article>`;
}

function render() {
  const list = applyFilters();
  const grid = $("#gameGrid");
  grid.innerHTML = list.map(renderCard).join("");
  $("#emptyState").hidden = list.length > 0;
  $("#resultCount").textContent = `${list.length}개 게임 표시 중`;
}

/* ---------- Filter chip builders ---------- */
function buildStatusFilters() {
  const opts = [
    { key: "all", label: "전체" },
    { key: "upcoming", label: "출시 예정" },
    { key: "released", label: "출시됨" },
  ];
  const wrap = $("#statusFilters");
  wrap.innerHTML = opts
    .map((o) => `<button class="chip ${o.key === STATE.status ? "active" : ""}" data-status="${o.key}">${o.label}</button>`)
    .join("");
  wrap.querySelectorAll(".chip").forEach((c) =>
    c.addEventListener("click", () => {
      STATE.status = c.dataset.status;
      buildStatusFilters();
      render();
    })
  );
}

function buildToggleFilters(containerId, values, stateSet, colorMap) {
  const wrap = $(containerId);
  wrap.innerHTML = values
    .map((v) => {
      const active = stateSet.has(v);
      const dot = colorMap ? `<span class="dot" style="background:${colorMap[v] || "#6c7aff"}"></span>` : "";
      return `<button class="chip ${active ? "active" : ""}" data-val="${v}">${dot}${v}</button>`;
    })
    .join("");
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
  const released = total - upcoming;
  $("#headerStats").innerHTML = `
    <div class="stat"><b>${upcoming}</b><span>출시 예정</span></div>
    <div class="stat"><b>${released}</b><span>출시됨</span></div>`;
}

/* ---------- Events ---------- */
function bindControls() {
  let t;
  $("#searchInput").addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      STATE.search = e.target.value;
      render();
    }, 120);
  });
  $("#sortSelect").addEventListener("change", (e) => {
    STATE.sort = e.target.value;
    render();
  });
  $("#resetBtn").addEventListener("click", () => {
    STATE.search = "";
    STATE.sort = "date-asc";
    STATE.status = "all";
    STATE.platforms.clear();
    STATE.genres.clear();
    $("#searchInput").value = "";
    $("#sortSelect").value = "date-asc";
    initFilters();
    render();
  });
}

function initFilters() {
  const platformColors = {
    PC: "#6c7aff", "PS5": "#5b8def", "Xbox Series": "#3ddc84",
    Switch: "#e74c3c", "Switch 2": "#e67e22", Mobile: "#f0c419",
  };
  const platforms = uniqueSorted(STATE.games.flatMap((g) => g.platforms));
  const genres = uniqueSorted(STATE.games.flatMap((g) => g.genres));
  buildStatusFilters();
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
  if (btn) {
    btn.disabled = !!busy;
    btn.classList.toggle("spinning", !!busy);
  }
}

function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

// Loads the full game list. `firstLoad` wires up controls once; subsequent
// calls (app entry/return, manual refresh) just refresh data + UI in place,
// preserving the user's current filters and sort.
async function loadGames(firstLoad = false) {
  if (isLoading) return;
  isLoading = true;
  setRefreshStatus("갱신 중…", true);
  try {
    // cache-busting query so app entry always pulls the latest for ALL games
    const res = await fetch(`data/games.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    STATE.games = data.games;
    lastFetchAt = Date.now();
    document.title = data.meta.title;
    $("#lastUpdated").textContent = `데이터 기준: ${data.meta.updated}`;
    renderHeaderStats();
    initFilters(); // selections persist (read from STATE sets), options refresh
    if (firstLoad) bindControls();
    render();
    setRefreshStatus(`최신 갱신 ${nowTime()}`, false);
  } catch (err) {
    setRefreshStatus("갱신 실패 (오프라인?)", false);
    if (firstLoad && !STATE.games.length) {
      $("#gameGrid").innerHTML = `<p class="empty-state">데이터를 불러오지 못했습니다.<br><small>${err}</small></p>`;
    }
  } finally {
    isLoading = false;
  }
}

function bindRefresh() {
  $("#refreshBtn").addEventListener("click", () => loadGames(false));
  // Refresh all games whenever the user returns to / re-enters the app,
  // throttled so quick tab switches don't spam the network.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastFetchAt > 30000) {
      loadGames(false);
    }
  });
  window.addEventListener("focus", () => {
    if (Date.now() - lastFetchAt > 30000) loadGames(false);
  });
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
