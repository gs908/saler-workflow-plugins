import multer from 'multer';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const UPLOAD_DIR = path.join(os.tmpdir(), 'claude-tasks-uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  },
});

const ALLOWED_EXTENSIONS = ['.md', '.txt', '.doc', '.docx', '.json', '.csv', '.yaml', '.yml', '.xml', '.html', '.js', '.ts', '.java', '.py', '.go', '.rs', '.sql', '.sh', '.bat', '.ps1', '.log', '.conf', '.cfg', '.ini', '.toml', '.pdf'];

const fileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_EXTENSIONS.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`不支持的文件类型: ${ext}，支持: ${ALLOWED_EXTENSIONS.join(', ')}`));
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 10,
  },
});

export function getUploadedFilePaths(files: Express.Multer.File[] | undefined): string[] {
  if (!files || !Array.isArray(files)) return [];
  return files.map(f => f.path);
}

export function cleanupFiles(filePaths: string[]): void {
  for (const fp of filePaths) {
    try {
      fs.unlinkSync(fp);
    } catch (err) {
      console.warn(`[FileHandler] Failed to delete file ${fp}:`, err);
    }
  }
}
