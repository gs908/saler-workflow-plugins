export interface CreateJobRequest {
  /** 源视频绝对路径（同机部署）或可 HTTP 拉取的 URL */
  source: string;
  /** 切片完成后 POST 的下游地址（内部回调用；对外接口可不传） */
  callbackUrl?: string;
  /** 业务流水号，透传进回调 body */
  execute_id?: string;
  /** 业务任务 ID，透传进回调 body */
  taskId?: string;
  /** 任务名称，用于 MinIO 路径分组（可选） */
  name?: string;
  /** 业务类型，默认 video_create */
  type?: string;
  /** 透传到下游回调 Header X-Presales-Video-Callback-Secret */
  callbackSecret?: string;
  /** 原始视频引用地址（HTTP URL），透传回下游 */
  videoUrl?: string;
}

export type JobStatus = 'pending' | 'running' | 'done' | 'fail';

export interface Job extends CreateJobRequest {
  id: string;
  status: JobStatus;
  createdAt: number;
  /** MinIO 路径日期前缀，入队时固定，确保预计算 URL 与实际上传路径一致 */
  hlsDate: string;
  playlistUrl?: string;
  error?: string;
}
