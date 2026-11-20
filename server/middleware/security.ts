import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import helmet from 'helmet';
import path from 'path';

export function configureHelmet() {
  const isProd = process.env.NODE_ENV === 'production';
  return helmet({
    // Allow Vite dev scripts/iframe preview cleanly while maintaining strict security headers
    contentSecurityPolicy: isProd ? undefined : false,
    crossOriginEmbedderPolicy: false,
    frameguard: false,
  });
}

function getClientKey(req: Request): string {
  const forwarded = req.headers.forwarded;
  if (typeof forwarded === 'string') {
    const match = forwarded.match(/for="?\[?([^;,"\]]+)\]?"?/i);
    if (match?.[1]) {
      const candidate = match[1].replace(/:\d+$/, '');
      if (candidate) {
        return ipKeyGenerator(candidate);
      }
    }
  }
  return ipKeyGenerator(req.ip || req.socket.remoteAddress || '127.0.0.1');
}

export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 400,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientKey,
  validate: { forwardedHeader: false, xForwardedForHeader: false },
  message: { error: 'Too many requests. Please slow down and try again shortly.' },
});

export const aiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientKey,
  validate: { forwardedHeader: false, xForwardedForHeader: false },
  message: { error: 'AI analysis rate limit exceeded. Please wait before submitting more requests.' },
});

export function requireAuthIfPublic(req: Request, res: Response, next: NextFunction): void {
  const configuredHost = process.env.HOST?.trim() || '0.0.0.0';
  const authToken = process.env.AUTH_TOKEN?.trim();

  // Only enforce bearer auth when explicitly configured via AUTH_TOKEN (for non-localhost exposure)
  if (!authToken || configuredHost === '127.0.0.1' || configuredHost === 'localhost') {
    next();
    return;
  }

  if (req.path === '/health') {
    next();
    return;
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!token || token.length !== authToken.length) {
    res.status(401).json({ error: 'Authentication required for non-localhost access.' });
    return;
  }

  const valid = crypto.timingSafeEqual(Buffer.from(token), Buffer.from(authToken));
  if (!valid) {
    res.status(401).json({ error: 'Invalid authentication token.' });
    return;
  }

  next();
}

export function safeResolveInDir(baseDir: string, targetFile: string): string {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, path.basename(targetFile));
  if (!resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new Error('Invalid file path detected.');
  }
  return resolvedTarget;
}

export function sanitizeLogError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/sk-[a-zA-Z0-9_-]{10,}/g, '[REDACTED_OPENAI_KEY]')
    .replace(/AIza[a-zA-Z0-9_-]{10,}/g, '[REDACTED_GEMINI_KEY]')
    .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]');
}
