import { CozeBaseClient, createConfigFromGlobal } from './coze-client';
import { CozeServiceError, CozeFileUploadError } from './errors';
import { FileUploadResult, Logger } from './types';
import fs from 'fs/promises';
import path from 'path';

/**
 * 文件服务
 * 负责文件上传到 Coze
 */
export class FileService extends CozeBaseClient {
  /** 最大文件大小限制：100MB */
  private readonly MAX_FILE_SIZE = 100 * 1024 * 1024;
  /** 文件上传超时：120秒 */
  private readonly UPLOAD_TIMEOUT = 120000;

  constructor(config = createConfigFromGlobal(), logger?: Logger) {
    super(config, logger);
  }

  /**
   * 校验文件上传前置条件
   * @returns 文件大小
   */
  private async validateFile(filePath: string): Promise<number> {
    try {
      const stats = await fs.stat(filePath);
      
      if (!stats.isFile()) {
        throw new CozeFileUploadError(`路径不是文件: ${filePath}`, undefined, filePath);
      }

      if (stats.size > this.MAX_FILE_SIZE) {
        throw new CozeFileUploadError(
          `文件过大: ${(stats.size / 1024 / 1024).toFixed(2)}MB，最大限制 100MB`,
          undefined,
          filePath
        );
      }

      return stats.size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new CozeFileUploadError(`文件不存在: ${filePath}`, undefined, filePath);
      }
      throw error;
    }
  }

  /**
   * 上传文件到 Coze
   * @param filePath - 文件路径
   * @returns 上传后的文件信息
   */
  async uploadFile(filePath: string): Promise<FileUploadResult> {
    this.logger.info(`[FileService] 上传文件: ${filePath}`);

    // 前置校验并获取文件大小
    const fileSize = await this.validateFile(filePath);

    try {
      // 使用 form-data 构造 multipart 请求
      const FormData = (await import('form-data')).default;
      const form = new FormData();
      
      // 使用 createReadStream 通过流的方式添加文件
      const { createReadStream } = await import('fs');
      form.append('file', createReadStream(filePath), {
        filename: path.basename(filePath),
        knownLength: fileSize,
      });

      // 统一使用 HttpClient 发送请求
      const response = await this.httpClient.post<{
        code: number;
        msg: string;
        data?: FileUploadResult;
      }>('/v1/files/upload', form, {
        headers: {
          ...form.getHeaders(),
        },
        timeout: this.UPLOAD_TIMEOUT,
        // 允许 form-data 自己设置 content-length
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });

      if (response.code !== 0 || !response.data) {
        throw new CozeFileUploadError(
          response.msg || '文件上传失败',
          undefined,
          filePath
        );
      }

      this.logger.info(`[FileService] 文件上传成功: ${response.data.id}`);
      return response.data;
    } catch (error) {
      this.logger.error('[FileService] 文件上传失败:', error);
      
      if (error instanceof CozeServiceError) {
        throw error;
      }
      
      throw new CozeFileUploadError(
        `文件上传失败: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
        filePath
      );
    }
  }

  /**
   * 批量上传多个文件
   * @param filePaths - 文件路径数组
   * @returns 上传结果数组
   */
  async uploadFiles(filePaths: string[]): Promise<FileUploadResult[]> {
    this.logger.info(`[FileService] 批量上传 ${filePaths.length} 个文件`);
    
    const results: FileUploadResult[] = [];
    
    for (const filePath of filePaths) {
      try {
        const result = await this.uploadFile(filePath);
        results.push(result);
      } catch (error) {
        this.logger.error(`[FileService] 文件 ${filePath} 上传失败:`, error);
        // 继续上传其他文件，不中断批量操作
        // 调用方可以检查结果数组判断哪些成功
      }
    }
    
    this.logger.info(`[FileService] 批量上传完成: ${results.length}/${filePaths.length} 成功`);
    return results;
  }
}
