import fs from 'node:fs';

/**
 * 安全删除目录：删除后验证，失败则延迟重试（Windows 文件锁兜底）
 */
export async function safeRemoveDir(dir: string, retries = 3): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* 忽略，下面验证 */ }
    if (!fs.existsSync(dir)) return;
    await new Promise(r => setTimeout(r, 500 * (i + 1)));
  }
  if (fs.existsSync(dir)) {
    console.warn(`[fs-utils] Failed to remove dir after ${retries} retries: ${dir}`);
  }
}
