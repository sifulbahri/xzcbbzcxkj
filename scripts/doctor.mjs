import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

function checkCmd(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}

console.log('=== Glints AI Job Assistant — Environment Diagnostics ===');
console.log(`OS: ${os.type()} ${os.release()} (${os.arch()})`);

const nodeVer = process.versions.node;
const [major, minor] = nodeVer.split('.').map(Number);
console.log(`Node.js: v${nodeVer}`);

if (major < 22 || (major === 22 && minor < 12)) {
  console.error(
    'FAIL: Node.js >= 22.12.0 is required by Vite 8, better-sqlite3 13, openai 7, and @google/genai 3.'
  );
  console.error(
    'On Linux Mint 22 (Ubuntu 24.04 base), default apt installs Node 18. Install Node 22 LTS via NodeSource or nvm:\n' +
      '  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -\n' +
      '  sudo apt-get install -y nodejs build-essential python3'
  );
} else if (major === 22 && minor < 18) {
  console.warn(
    'WARN: Node 22.12–22.17 needs tsx for `npm run start:compat` (unflagged `node server.ts` requires Node >= 22.18.0).'
  );
} else {
  console.log('OK: Node.js version satisfies all packages and native TypeScript execution.');
}

const npmVer = checkCmd('npm -v');
console.log(`npm: ${npmVer || 'NOT FOUND'}`);

const gccVer = checkCmd('g++ --version | head -n 1');
const makeVer = checkCmd('make --version | head -n 1');
const pyVer = checkCmd('python3 --version');
console.log(`Build tools: g++=${gccVer ? 'OK' : 'MISSING'}, make=${makeVer ? 'OK' : 'MISSING'}, python3=${pyVer || 'MISSING'}`);

if (!gccVer || !makeVer || !pyVer) {
  console.warn(
    'WARN: Missing C++ build tools for native addons (better-sqlite3 fallback build). Install with:\n' +
      '  sudo apt-get install -y build-essential python3'
  );
}

try {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  const row = db.prepare('SELECT sqlite_version() AS v').get();
  db.close();
  console.log(`OK: better-sqlite3 native binding loaded (SQLite ${row.v}).`);
} catch (err) {
  console.error('FAIL: better-sqlite3 could not load:', err instanceof Error ? err.message : String(err));
  console.error('Try rebuilding native modules: npm rebuild better-sqlite3');
}

const envPath = path.resolve(process.cwd(), '.env');
console.log(`.env file: ${fs.existsSync(envPath) ? 'Present' : 'Missing (copy .env.example to .env)'}`);
console.log(`dist/ build: ${fs.existsSync(path.resolve(process.cwd(), 'dist', 'index.html')) ? 'Present' : 'Not built yet (run npm run build)'}`);
