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
const newsMonthKey = (d) => String(d || "").replace(/\./g, "-").slice(0, 7); // "2026.06.01" → "2026-06"

function applyFilters() {
  const list = STATE.games.filter((g) => {
    if (STATE.platform === "event") {
      if (!EVENT_TYPES.includes(g.eventType)) return false;          // 이벤트 탭: 업데이트·행사·테스트
    } else {
      if (EVENT_TYPES.includes(g.eventType)) return false;           // 출시 탭: 콘솔/PC/모바일 통합(게임당 1건), 이벤트 제외
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
    <article class="card" data-gid="${esc(g.id)}">
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
  let list = STATE.news || [];
  if (STATE.month !== "all") list = list.filter((n) => n.date && newsMonthKey(n.date) === STATE.month);
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
  buildMonthSelect();   // 탭별로 기간 옵션이 다름(뉴스=뉴스 날짜, 그 외=일정 월)
  render();
  if (cat === "news" && Date.now() - lastFetchAt > 5000) loadGames(false); // 뉴스 탭 진입 시 최신 갱신
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
    months = [...new Set(STATE.games.map((g) => monthKey(g.releaseDate)))].sort();
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

/* ---------- App icon presets (설정 → 아이콘 변경) ---------- */
const ICON_PRESETS = [
  { key: "sword",  name: "검사",   src: "icons/preset-sword.png" },
  { key: "voyage", name: "여행자", src: "icons/preset-voyage.png" },
  { key: "hunter", name: "헌터",   src: "icons/preset-hunter.png" },
  { key: "knight", name: "나이트", src: "icons/preset-knight.png" },
  { key: "ranger", name: "레인저", src: "icons/preset-ranger.png" },
];
function savedIconKey() {
  try { return localStorage.getItem("gnw-icon") || "sword"; } catch { return "sword"; }
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
  // 카드 → 외부 상세링크. 뉴스 → 앱 내 다크 상세뷰. (카드 안 링크/▶영상은 자체 동작)
  $("#gameRoot").addEventListener("click", (e) => {
    if (e.target.closest("a, .play-btn")) return;
    const card = e.target.closest(".card[data-gid]");
    if (card) {
      const g = STATE.games.find((x) => String(x.id) === card.dataset.gid);
      const url = g && (g.detailUrl || (g.source && g.source.url));
      if (url) window.open(url, "_blank", "noopener");
      return;
    }
    const ni = e.target.closest(".news-item[data-ni]");
    if (ni && STATE._newsView) {
      const n = STATE._newsView[+ni.dataset.ni];
      if (n) openDetail(n);
    }
  });
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
  const banner = n.image
    ? `<div class="detail-banner"><img src="${esc(n.image)}" alt="" referrerpolicy="no-referrer" onerror="this.closest('.detail-banner').remove()"></div>`
    : "";
  let body;
  if (n.content && n.content.length) {
    body = n.content.map((b) => b.t === "img"
      ? `<img class="detail-img" src="${esc(b.v)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
      : `<p>${esc(b.v)}</p>`).join("");
  } else if (n.summary) {
    body = `<p>${esc(n.summary)}</p>`;
  } else {
    body = `<p class="detail-empty">본문을 불러오지 못했습니다. 아래 ‘원문 보기’에서 확인하세요.</p>`;
  }
  $("#detailBody").innerHTML = `
    <h1 class="detail-title">${esc(n.title)}</h1>
    <div class="detail-meta">${meta}</div>
    ${banner}
    <div class="detail-article">${body}</div>
    ${n.url ? `<a class="detail-orig" href="${esc(n.url)}" target="_blank" rel="noopener">원문 보기 ↗</a>` : ""}`;
  $("#detailScroll").scrollTop = 0;
  sheet.hidden = false;
  document.body.classList.add("sheet-open");
}
function closeDetail() {
  $("#detailSheet").hidden = true;
  document.body.classList.remove("sheet-open");
}
function bindDetail() {
  $("#detailClose").addEventListener("click", closeDetail);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#detailSheet").hidden) closeDetail(); });
}

/* ---------- Init ---------- */
async function init() {
  bindTabs();
  bindSettings();
  bindCardClicks();
  bindDetail();
  applyIcon(savedIconKey());
  $("#monthSelect").addEventListener("change", (e) => { STATE.month = e.target.value; render(); });
  bindAutoRefresh();
  await loadGames(true);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

init();
