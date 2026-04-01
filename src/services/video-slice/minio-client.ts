import fs from 'node:fs';
import path from 'node:path';
import * as Minio from 'minio';
import { config } from './config';

let _client: Minio.Client | null = null;

function getClient(): Minio.Client {
  if (!_client) {
    _client = new Minio.Client(config.minio);
  }
  return _client;
}

/** 确保 bucket 存在且公开可读，不存在则创建 */
async function ensureBucket(): Promise<void> {
  const client = getClient();
  const exists = await client.bucketExists(config.minio.bucket);
  if (!exists) {
    await client.makeBucket(config.minio.bucket);
    console.log(`[MinIO] Created bucket: ${config.minio.bucket}`);
  }
  // 设置公开只读策略，允许匿名 GET（HLS 播放必须）
  const policy = JSON.stringify({
    Version: '2012-10-17',
    Statement: [{
      Effect:    'Allow',
      Principal: '*',
      Action:    ['s3:GetObject'],
      Resource:  [`arn:aws:s3:::${config.minio.bucket}/*`],
    }],
  });
  await client.setBucketPolicy(config.minio.bucket, policy);
}

/** 将本地目录下所有文件上传到 MinIO，prefix 为对象路径前缀 */
export async function uploadDir(localDir: string, prefix: string): Promise<void> {
  await ensureBucket();
  const client = getClient();
  const files = fs.readdirSync(localDir);
  for (const file of files) {
    const localPath  = path.join(localDir, file);
    const objectName = `${prefix}/${file}`;
    await client.fPutObject(config.minio.bucket, objectName, localPath);
  }
  console.log(`[MinIO] Uploaded ${files.length} files with prefix=${prefix}`);
}

/** 拼接 MinIO 对象的公开访问 URL */
export function buildMinioUrl(objectKey: string): string {
  return `${config.minio.publicUrl}/${config.minio.bucket}/${objectKey}`;
}
