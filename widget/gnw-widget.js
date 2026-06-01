// GNW — Game New Watch · iOS Widget
// ----------------------------------------------------------------------------
// Scriptable widget that reuses the SAME data/games.json as the web app, so the
// web app and the iOS Home Screen widget never drift apart.
//
// HOW TO USE
//   1. Install "Scriptable" from the App Store (free).
//   2. Host this repo (e.g. GitHub Pages) and copy the games.json URL below.
//   3. Create a new Scriptable script, paste this file's contents.
//   4. Add a Scriptable widget to the Home Screen, long-press → Edit Widget →
//      choose this script. Small / Medium / Large are all supported.
//
// The widget shows the next upcoming releases with a D-day countdown, and falls
// back to the bundled list if offline.
// ----------------------------------------------------------------------------

// 👉 Replace with your hosted raw URL, e.g.
// "https://rockyhong-a11y.github.io/gnw/data/games.json"
const DATA_URL = "https://raw.githubusercontent.com/rockyhong-a11y/gnw/main/data/games.json";

const COLORS = {
  bg1: new Color("#161a2c"),
  bg2: new Color("#0d0f1a"),
  text: new Color("#eef1ff"),
  dim: new Color("#9aa2c4"),
  accent: new Color("#6c7aff"),
  green: new Color("#3ddc84"),
  amber: new Color("#ffb454"),
};

// eventType → 한글 라벨 / 색상 (웹앱·인벤 캘린더 분류와 동일)
const EVENT_META = {
  release: { label: "출시", color: new Color("#3ddc84") },
  update:  { label: "업데이트", color: new Color("#00c2cb") },
  ea:      { label: "얼리액세스", color: new Color("#6c7aff") },
  test:    { label: "테스트", color: new Color("#ffb454") },
  event:   { label: "행사", color: new Color("#ff85c0") },
};
const gameName = (g) => g.titleKr || g.title;

const NOW = new Date();

async function fetchGames() {
  try {
    const req = new Request(DATA_URL);
    req.timeoutInterval = 10;
    const data = await req.loadJSON();
    return data.games || [];
  } catch (e) {
    return []; // offline / error → empty, handled by caller
  }
}

function daysUntil(dateStr) {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  const today = new Date(NOW);
  today.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}

function ddayLabel(g) {
  const days = daysUntil(g.releaseDate);
  if (g.status === "released" || days < 0) return "출시됨";
  if (days === 0) return "오늘!";
  return `D-${days}`;
}

function upcomingSorted(games) {
  return games
    .filter((g) => g.status === "upcoming" && daysUntil(g.releaseDate) >= 0)
    .sort((a, b) => new Date(a.releaseDate) - new Date(b.releaseDate));
}

function gradientBg() {
  const g = new LinearGradient();
  g.colors = [COLORS.bg1, COLORS.bg2];
  g.locations = [0, 1];
  return g;
}

function addHeader(stack) {
  const header = stack.addStack();
  header.centerAlignContent();
  const mark = header.addText("GNW");
  mark.font = Font.heavySystemFont(13);
  mark.textColor = COLORS.accent;
  header.addSpacer(6);
  const sub = header.addText("신작 출시 일정");
  sub.font = Font.mediumSystemFont(11);
  sub.textColor = COLORS.dim;
}

function addGameRow(stack, g, compact) {
  const row = stack.addStack();
  row.centerAlignContent();
  if (g.trailer) row.url = g.trailer; // tap a row → open its trailer (iOS 17+)

  // color dot
  const dot = row.addStack();
  dot.size = new Size(8, 8);
  dot.cornerRadius = 4;
  dot.backgroundColor = new Color(g.color || "#6c7aff");
  row.addSpacer(8);

  const info = row.addStack();
  info.layoutVertically();
  const title = info.addText(gameName(g));
  title.font = Font.semiboldSystemFont(compact ? 12 : 13);
  title.textColor = COLORS.text;
  title.lineLimit = 1;
  const evMeta = EVENT_META[g.eventType] || { label: "", color: COLORS.dim };
  if (!compact) {
    const meta = info.addText(`${evMeta.label} · ${g.platforms.slice(0, 2).join(" · ")}`);
    meta.font = Font.systemFont(10);
    meta.textColor = COLORS.dim;
    meta.lineLimit = 1;
  }

  row.addSpacer();
  const dday = row.addText(ddayLabel(g));
  const days = daysUntil(g.releaseDate);
  dday.font = Font.heavySystemFont(compact ? 12 : 13);
  dday.textColor = days <= 14 ? COLORS.amber : COLORS.green;
}

function buildSmall(w, games) {
  w.addSpacer(2);
  const g = games[0];
  const big = w.addText(ddayLabel(g));
  big.font = Font.heavySystemFont(30);
  big.textColor = daysUntil(g.releaseDate) <= 14 ? COLORS.amber : COLORS.green;
  const evMeta = EVENT_META[g.eventType] || { label: "" };
  const tag = w.addText(evMeta.label);
  tag.font = Font.boldSystemFont(11);
  tag.textColor = (evMeta.color || COLORS.accent);
  const title = w.addText(gameName(g));
  title.font = Font.semiboldSystemFont(13);
  title.textColor = COLORS.text;
  title.lineLimit = 2;
  w.addSpacer(4);
  const date = w.addText(g.releaseDate.replace(/-/g, "."));
  date.font = Font.systemFont(11);
  date.textColor = COLORS.dim;
}

function buildList(w, games, count, compact) {
  for (let i = 0; i < Math.min(count, games.length); i++) {
    addGameRow(w, games[i], compact);
    if (i < count - 1) w.addSpacer(compact ? 6 : 9);
  }
}

async function main() {
  const games = await fetchGames();
  const upcoming = upcomingSorted(games);

  const w = new ListWidget();
  w.backgroundGradient = gradientBg();
  w.setPadding(14, 14, 14, 14);

  if (!upcoming.length) {
    const t = w.addText("출시 예정 게임 정보를 불러올 수 없습니다.");
    t.font = Font.mediumSystemFont(12);
    t.textColor = COLORS.dim;
    Script.setWidget(w);
    Script.complete();
    return;
  }

  const family = config.widgetFamily || "medium";
  if (family === "small") {
    buildSmall(w, upcoming);
    if (upcoming[0].trailer) w.url = upcoming[0].trailer; // tap → open trailer
  } else {
    addHeader(w);
    w.addSpacer(10);
    const count = family === "large" ? 6 : 3;
    buildList(w, upcoming, count, family !== "large");
  }

  w.addSpacer();
  Script.setWidget(w);
  if (!config.runsInWidget) await w.presentMedium();
  Script.complete();
}

await main();
