// GNW — Game New Watch · iOS Widget (Scriptable)
// ----------------------------------------------------------------------------
// 웹앱과 "동일한" data/games.json 을 사용 → 웹앱과 위젯 데이터가 이원화되지 않습니다.
//
// 설치
//   1) App Store에서 Scriptable(무료) 설치
//   2) 이 저장소를 호스팅(예: GitHub Pages)하고 data/games.json URL 확보
//   3) Scriptable에서 새 스크립트 생성 → 이 파일 내용 붙여넣기
//   4) 아래 DATA_URL 을 본인 호스팅 URL로 교체
//   5) 홈 화면에 Scriptable 위젯 추가 → 길게 눌러 "Edit Widget" → 이 스크립트 선택
//
// 뉴스/출시/이벤트 분리
//   Edit Widget 화면의 "Parameter" 칸에 아래 중 하나 입력(여러 위젯 가능):
//     release | 출시   (기본값)
//     news    | 뉴스
//     event   | 이벤트
//
// 크기별 표시 개수
//   Small : 가장 임박한 1개 (출시/이벤트는 큰 D-day)
//   Medium: 다음 3개 · Large: 다음 6개
// ----------------------------------------------------------------------------

// 👉 본인 호스팅 URL로 교체 (raw도 동작 / Pages 예: https://rockyhong-a11y.github.io/GNW/data/games.json)
const DATA_URL = "https://raw.githubusercontent.com/rockyhong-a11y/gnw/main/data/games.json";
// 위젯 배경 탭 시 열 웹앱 주소 (Pages 주소로 두면 앱이 열립니다)
const APP_URL = "https://rockyhong-a11y.github.io/GNW/";

const C = {
  bg1: new Color("#161a2c"), bg2: new Color("#0d0f1a"),
  text: new Color("#eef1ff"), dim: new Color("#9aa2c4"), faint: new Color("#6b7280"),
  accent: new Color("#6c7aff"), green: new Color("#3ddc84"), amber: new Color("#ffb454"),
  chipDark: new Color("#2a2f3e"), ink: new Color("#0b0d16"),
};

const EVENT_TYPES = ["update", "event", "test"]; // 이벤트 카테고리에 표시할 종류
const EVENT_META = {
  release: { label: "출시", color: new Color("#3ddc84") },
  update:  { label: "업데이트", color: new Color("#00c2cb") },
  ea:      { label: "얼리액세스", color: new Color("#6c7aff") },
  test:    { label: "테스트", color: new Color("#ffb454") },
  event:   { label: "행사", color: new Color("#ff85c0") },
};

function resolveCategory(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (["news", "뉴스"].includes(v)) return "news";
  if (["event", "이벤트", "행사"].includes(v)) return "event";
  return "release";
}

// ---- 날짜 ----
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr); if (isNaN(d)) return null;
  d.setHours(0, 0, 0, 0);
  return Math.round((d - startOfToday()) / 86400000);
}
function ddayText(dateStr, status) {
  const days = daysUntil(dateStr);
  if (status === "released" || days == null || days < 0) return "출시됨";
  if (days === 0) return "오늘!";
  return `D-${days}`;
}
function ddayColor(dateStr, status) {
  const days = daysUntil(dateStr);
  if (status === "released" || days == null || days < 0) return C.dim;
  return days <= 14 ? C.amber : C.green;
}
function fmtDate(dateStr) {
  const m = String(dateStr || "").match(/(\d{4})[.\-](\d{2})[.\-](\d{2})/);
  return m ? `${m[2]}.${m[3]}` : String(dateStr || "");
}
function newsTime(n) {
  if (!n.date) return 0;
  const p = String(n.date).split(".");
  if (p.length < 3) return 0;
  return new Date(`${p[0]}-${p[1]}-${p[2]}T${n.time || "00:00"}`).getTime() || 0;
}

// ---- 카테고리별 항목 ----
function pickItems(data, category, count) {
  if (category === "news") {
    return (data.news || []).slice()
      .sort((a, b) => newsTime(b) - newsTime(a))
      .slice(0, count)
      .map((n) => ({ title: n.title, date: n.date, sub: n.source || "루리웹", image: n.image, url: n.url }));
  }
  const games = (data.games || []).filter((g) =>
    category === "event" ? EVENT_TYPES.includes(g.eventType) : !EVENT_TYPES.includes(g.eventType));
  const tagged = games.map((g) => ({ g, d: daysUntil(g.releaseDate) }));
  const upcoming = tagged.filter((x) => x.d != null && x.d >= 0).sort((a, b) => a.d - b.d);
  const past = tagged.filter((x) => x.d == null || x.d < 0).sort((a, b) => (b.d ?? -1e9) - (a.d ?? -1e9));
  return upcoming.concat(past).slice(0, count).map(({ g }) => ({
    title: g.titleKr || g.title,
    date: g.releaseDate,
    sub: (g.platforms || []).slice(0, 3).join(" · ") || (EVENT_META[g.eventType] || {}).label || "",
    image: g.image,
    url: g.detailUrl || (g.source && g.source.url) || APP_URL,
    badge: ddayText(g.releaseDate, g.status),
    badgeColor: ddayColor(g.releaseDate, g.status),
    color: g.color,
  }));
}

async function tryImage(url) {
  if (!url) return null;
  try { const r = new Request(url); r.timeoutInterval = 8; return await r.loadImage(); } catch { return null; }
}

function gradientBg() {
  const g = new LinearGradient();
  g.colors = [C.bg1, C.bg2]; g.locations = [0, 1];
  return g;
}

// ---- 빌드 ----
async function buildWidget() {
  const family = config.widgetFamily || "medium";
  const category = resolveCategory(args.widgetParameter);
  const count = family === "small" ? 1 : family === "large" ? 6 : 3;

  const w = new ListWidget();
  w.backgroundGradient = gradientBg();
  w.setPadding(14, 14, 14, 14);
  w.url = APP_URL;

  let data;
  try { const req = new Request(DATA_URL); req.timeoutInterval = 15; data = await req.loadJSON(); }
  catch (e) {
    const t = w.addText("데이터를 불러오지 못했습니다."); t.font = Font.mediumSystemFont(12); t.textColor = C.dim;
    return w;
  }

  const catLabel = category === "news" ? "뉴스" : category === "event" ? "이벤트" : "출시 예정";
  const items = pickItems(data, category, count);

  // 헤더
  const head = w.addStack();
  head.centerAlignContent();
  const mark = head.addText("GNW");
  mark.font = Font.heavySystemFont(13); mark.textColor = C.accent;
  head.addSpacer(6);
  const sub = head.addText(catLabel);
  sub.font = Font.mediumSystemFont(11); sub.textColor = C.dim;
  head.addSpacer();
  if (data.meta && data.meta.updated) {
    const up = head.addText(String(data.meta.updated).slice(5));
    up.font = Font.systemFont(10); up.textColor = C.faint;
  }
  w.addSpacer(family === "small" ? 8 : 10);

  if (!items.length) {
    const t = w.addText("표시할 항목이 없습니다."); t.font = Font.mediumSystemFont(12); t.textColor = C.dim;
    return w;
  }

  if (family === "small") renderSmall(w, items[0], category);
  else {
    for (let i = 0; i < items.length; i++) {
      if (i) w.addSpacer(family === "large" ? 9 : 8);
      await renderRow(w, items[i], category, family === "large");
    }
  }
  w.addSpacer();
  return w;
}

// Small
function renderSmall(w, it, category) {
  if (category !== "news") {
    const big = w.addText(it.badge);
    big.font = Font.heavySystemFont(32); big.textColor = it.badgeColor;
    w.addSpacer(3);
  }
  const title = w.addText(it.title || "");
  title.font = Font.semiboldSystemFont(category === "news" ? 15 : 15);
  title.textColor = C.text; title.lineLimit = category === "news" ? 4 : 3;
  w.addSpacer(4);
  const meta = w.addText([fmtDate(it.date), it.sub].filter(Boolean).join("  ·  "));
  meta.font = Font.systemFont(11); meta.textColor = C.dim; meta.lineLimit = 1;
}

// Medium/Large 한 줄
async function renderRow(w, it, category, large) {
  const row = w.addStack();
  row.centerAlignContent();
  row.url = it.url || APP_URL;

  const img = await tryImage(it.image);
  if (img) {
    const im = row.addImage(img);
    im.imageSize = new Size(46, 34); im.cornerRadius = 7; im.resizable = true;
    row.addSpacer(9);
  } else {
    const dot = row.addStack();
    dot.size = new Size(8, 8); dot.cornerRadius = 4;
    dot.backgroundColor = new Color(it.color || "#6c7aff");
    row.addSpacer(9);
  }

  const col = row.addStack();
  col.layoutVertically(); col.spacing = 2;

  const title = col.addText(it.title || "");
  title.font = Font.semiboldSystemFont(13); title.textColor = C.text; title.lineLimit = 2;

  const metaRow = col.addStack();
  metaRow.centerAlignContent();
  if (category !== "news" && it.badge) {
    const chip = metaRow.addStack();
    chip.backgroundColor = it.badge === "출시됨" ? C.chipDark : it.badgeColor;
    chip.cornerRadius = 4; chip.setPadding(1, 5, 1, 5);
    const bt = chip.addText(it.badge);
    bt.font = Font.boldSystemFont(10);
    bt.textColor = it.badge === "출시됨" ? C.dim : C.ink;
    metaRow.addSpacer(6);
  }
  const meta = metaRow.addText([fmtDate(it.date), it.sub].filter(Boolean).join("  ·  "));
  meta.font = Font.systemFont(10.5); meta.textColor = C.dim; meta.lineLimit = 1;

  row.addSpacer();
}

// ---- 실행 ----
const widget = await buildWidget();
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  const fam = config.widgetFamily || "medium";
  if (fam === "small") await widget.presentSmall();
  else if (fam === "large") await widget.presentLarge();
  else await widget.presentMedium();
}
Script.complete();
