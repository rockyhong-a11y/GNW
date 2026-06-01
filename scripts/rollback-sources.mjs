#!/usr/bin/env node
/* 참조 사이트 롤백 도구
 * ---------------------------------------------------------------------------
 * "인벤 발매 캘린더 단일 참조"로 바꾼 결과가 마음에 들지 않을 때,
 * 변경 전(멀티소스: 네이버/인벤/디스이즈게임/TapTap/루리웹) 상태로 되돌린다.
 *
 *   node scripts/rollback-sources.mjs           # 멀티소스 백업으로 복원 후 games.json 재생성
 *
 * 동작: data/curated.multisource.backup.json → data/curated.json 으로 복원하고
 *      build-data.mjs 를 실행해 data/games.json 을 다시 만든다.
 * (git revert <commit> 으로도 동일하게 되돌릴 수 있다.)
 * --------------------------------------------------------------------------- */
import { readFile, writeFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BACKUP = join(ROOT, "data/curated.multisource.backup.json");
const CURATED = join(ROOT, "data/curated.json");

async function exists(p) { try { await access(p); return true; } catch { return false; } }

async function main() {
  if (!(await exists(BACKUP))) {
    console.error("백업 파일이 없습니다: data/curated.multisource.backup.json");
    console.error("→ 대신 git 으로 되돌리세요: git revert <변경 커밋 해시>");
    process.exit(1);
  }
  const backup = await readFile(BACKUP, "utf8");
  const restored = JSON.parse(backup);
  await writeFile(CURATED, JSON.stringify(restored, null, 2) + "\n");
  console.log(`복원: curated.json ← 멀티소스 백업 (sources: ${restored.meta.sources.map((s) => s.name).join(", ")})`);

  const r = spawnSync(process.execPath, [join(ROOT, "scripts/build-data.mjs")], { stdio: "inherit" });
  process.exit(r.status ?? 0);
}
main();
