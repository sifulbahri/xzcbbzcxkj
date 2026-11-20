import crypto from 'crypto';
import fs from 'fs';
import mammoth from 'mammoth';
import { createRequire } from 'module';
import multer from 'multer';
import path from 'path';
import { safeResolveInDir } from '../middleware/security.ts';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (
  buffer: Buffer
) => Promise<{ text: string; numpages: number }>;

export const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
const MAX_CV_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/octet-stream', // fallback when browser sends generic MIME; verified via extension + magic bytes
]);

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.docx']);

function ensureUploadsDir(): void {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureUploadsDir();
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ALLOWED_EXTENSIONS.has(ext) ? ext : '.bin';
    const randomName = `${Date.now()}-${crypto.randomUUID()}${safeExt}`;
    cb(null, randomName);
  },
});

export const cvUploadMiddleware = multer({
  storage,
  limits: {
    fileSize: MAX_CV_FILE_SIZE,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      cb(new Error('Only .pdf and .docx CV files are permitted.'));
      return;
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new Error(`Unsupported file MIME type: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
});

function verifyMagicBytes(buffer: Buffer, ext: string): boolean {
  if (buffer.length < 4) return false;
  if (ext === '.pdf') {
    // %PDF
    return buffer.subarray(0, 4).toString('ascii') === '%PDF';
  }
  if (ext === '.docx') {
    // PK zip signature (0x50 0x4B 0x03 0x04)
    return buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  }
  return false;
}

export async function extractCvText(storedFilename: string, originalFilename: string): Promise<string> {
  const filePath = safeResolveInDir(UPLOADS_DIR, storedFilename);
  const ext = path.extname(originalFilename).toLowerCase();
  const buffer = await fs.promises.readFile(filePath);

  if (!verifyMagicBytes(buffer, ext)) {
    await fs.promises.unlink(filePath).catch(() => {});
    throw new Error('File signature verification failed. Please upload a valid PDF or DOCX file.');
  }

  let extracted = '';
  if (ext === '.pdf') {
    const parsed = await pdfParse(buffer);
    extracted = parsed.text || '';
  } else if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer });
    extracted = result.value || '';
  }

  const normalized = extracted
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (normalized.length < 30) {
    throw new Error(
      'Unable to extract readable text from this file. Please ensure the PDF/DOCX is text-based rather than a scanned image.'
    );
  }

  return normalized;
}
