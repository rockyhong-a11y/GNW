#!/usr/bin/env node
/* 참조/데이터 롤백 도구
 * ---------------------------------------------------------------------------
 * 변경 결과가 마음에 들지 않을 때 이전 큐레이션 상태로 되돌린다.
 *
 *   node scripts/rollback-sources.mjs          # 직전 상태(prev)로 복원
 *   node scripts/rollback-sources.mjs multi     # 멀티소스 상태로 복원
 *   node scripts/rollback-sources.mjs list      # 사용 가능한 백업 목록
 *
 * 백업 파일
 *   data/curated.prev.backup.json         직전(단일 인벤소스·63종) 상태
 *   data/curated.multisource.backup.json  멀티소스(네이버/인벤/디스이즈게임/TapTap/루리웹) 상태
 *
 * 복원 후 build-data.mjs 를 실행해 data/games.json 을 다시 만든다.
 * (git revert <commit> 으로도 되돌릴 수 있다.)
 * --------------------------------------------------------------------------- */
import { readFile, writeFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CURATED = join(ROOT, "data/curated.json");
const BACKUPS = {
  prev: join(ROOT, "data/curated.prev.backup.json"),
  multi: join(ROOT, "data/curated.multisource.backup.json"),
};

async function exists(p) { try { await access(p); return true; } catch { return false; } }

async function main() {
  const arg = (process.argv[2] || "prev").toLowerCase();
  if (arg === "list") {
    for (const [k, p] of Object.entries(BACKUPS)) console.log(`${(await exists(p)) ? "[O]" : "[X]"} ${k}: ${p}`);
    return;
  }
  const target = BACKUPS[arg];
  if (!target) { console.error(`알 수 없는 대상: ${arg} (prev | multi | list)`); process.exit(1); }
  if (!(await exists(target))) {
    console.error(`백업 파일 없음: ${target}\n→ 대신 git 으로 되돌리세요: git revert <변경 커밋 해시>`);
    process.exit(1);
  }
  const restored = JSON.parse(await readFile(target, "utf8"));
  await writeFile(CURATED, JSON.stringify(restored, null, 2) + "\n");
  console.log(`복원: curated.json ← ${arg} 백업 (games: ${restored.games.length}, sources: ${restored.meta.sources.map((s) => s.name).join(", ")})`);

  const r = spawnSync(process.execPath, [join(ROOT, "scripts/build-data.mjs")], { stdio: "inherit" });
  process.exit(r.status ?? 0);
}
main();
