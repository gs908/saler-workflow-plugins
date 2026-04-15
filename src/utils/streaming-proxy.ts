import http from 'node:http';
import https from 'node:https';
import type { Response } from 'express';

/**
 * 代理远程 HTTP/HTTPS 视频流到响应
 * 用于 MinIO 等对象存储的视频代理
 */
export function proxyHttpVideo(
  url: string,
  res: Response,
  options: {
    filename?: string;
    contentType?: string;
  }
): void {
  const { filename, contentType = 'video/mp4' } = options;

  const client = url.startsWith('https') ? https : http;

  client.get(url, (upstream) => {
    if (upstream.headers['content-length']) {
      res.setHeader('Content-Length', upstream.headers['content-length']);
    }

    res.setHeader('Content-Type', contentType);

    if (filename) {
      const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
      res.setHeader('Content-Disposition', disposition);
    }

    upstream.pipe(res);
  }).on('error', () => {
    if (!res.headersSent) {
      res.status(502).json({ error: 'Failed to fetch video from storage' });
    } else {
      res.destroy();
    }
  });
}

/**
 * 生成 Content-Disposition 响应头
 */
export function buildContentDisposition(
  name: string | null,
  fallbackId: string,
  ext: string = 'mp4'
): string {
  const filename = `${name || fallbackId}.${ext}`;
  return `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
