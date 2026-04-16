import fs from 'node:fs';
import path from 'node:path';

/**
 * 删除目录：逐个删除文件再删目录（兼容 Windows 中文路径）。
 * fs.rmSync({recursive:true}) 在 Windows 中文路径下会静默失败，不报错也不删除。
 */
function removeDirRecursive(dir: string): void {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      removeDirRecursive(full);
    } else {
      fs.unlinkSync(full);
    }
  }
  fs.rmdirSync(dir);
}

/**
 * 安全删除目录：先等待文件句柄释放，再删除并验证，失败则重试。
 */
export async function safeRemoveDir(dir: string, retries = 3): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      removeDirRecursive(dir);
    } catch (e) {
      console.warn(`[fs-utils] removeDir attempt ${i + 1} failed: ${e instanceof Error ? e.message : e}`);
    }
    if (!fs.existsSync(dir)) return;
    await new Promise(r => setTimeout(r, 1000 * (i + 1)));
  }
  if (fs.existsSync(dir)) {
    console.warn(`[fs-utils] Failed to remove dir after ${retries} retries: ${dir}`);
  }
}
