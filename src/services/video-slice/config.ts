import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const minioEndpoint = process.env.MINIO_ENDPOINT || 'localhost';
const minioPort     = Number(process.env.MINIO_PORT) || 9000;

export const config = {
  storageType: (process.env.HLS_STORAGE_TYPE || 'local') as 'local' | 'minio',
  hlsOutputDir: process.env.HLS_OUTPUT_DIR
    ? path.resolve(process.env.HLS_OUTPUT_DIR)
    : path.join(process.cwd(), "data", "hls"),
  // local 模式下用于拼 playlist_url
  hlsPublicBaseUrl: (process.env.HLS_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 5699}`).replace(/\/+$/, ""),
  hlsUrlPathPrefix: (process.env.HLS_URL_PATH_PREFIX || "/media/hls").replace(/\/?$/, "").replace(/^([^/])/, "/$1"),
  hlsSegmentTime: Number(process.env.HLS_SEGMENT_TIME) || 30,
  ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg",
  ingestSecret: (process.env.SLICE_SERVICE_INGEST_SECRET || "").trim(),
  downstreamCallbackTimeoutMs:
    Number(process.env.SLICE_DOWNSTREAM_CALLBACK_TIMEOUT_MS) || 120000,
  minio: {
    endPoint:  minioEndpoint,
    port:      minioPort,
    useSSL:    process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
    bucket:    process.env.MINIO_BUCKET     || 'report-video',
    publicUrl: (process.env.MINIO_PUBLIC_URL || `http://${minioEndpoint}:${minioPort}`).replace(/\/+$/, ''),
  },
};
