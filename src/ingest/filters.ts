import { posix } from 'node:path';

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'bower_components', 'jspm_packages', 'vendor', 'third_party',
  'dist', 'build', 'out', 'coverage', '.nyc_output', 'target',
  '.next', '.nuxt', '.svelte-kit', '.astro', '.turbo', '.vercel', '.netlify', '.cache', '.parcel-cache',
  '__pycache__', '.venv', 'venv', '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache', 'site-packages',
  '.gradle', '.idea', '.vscode', 'Pods', 'DerivedData', '.dart_tool', '.terraform', '.yarn', '.pnpm-store',
]);

const LOCKFILES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb',
  'cargo.lock', 'poetry.lock', 'pipfile.lock', 'uv.lock', 'composer.lock', 'gemfile.lock', 'go.sum',
  'mix.lock', 'pubspec.lock', 'podfile.lock', 'packages.lock.json', 'flake.lock', 'gradle.lockfile',
]);

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'icns', 'tif', 'tiff', 'avif', 'heic', 'psd', 'ai', 'sketch', 'fig',
  'mp3', 'mp4', 'm4a', 'wav', 'ogg', 'flac', 'aac', 'mov', 'avi', 'mkv', 'webm',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'tar', 'jar', 'war', 'ear', 'apk', 'aab', 'ipa', 'dmg', 'iso',
  'class', 'dll', 'exe', 'so', 'dylib', 'a', 'o', 'obj', 'lib', 'pdb', 'wasm', 'pyc', 'pyo', 'node',
  'bin', 'dat', 'db', 'sqlite', 'sqlite3', 'parquet', 'pkl', 'pt', 'onnx', 'safetensors', 'h5',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
]);

const DATA_EXTENSIONS = new Set(['json', 'csv', 'tsv', 'xml', 'yaml', 'yml', 'txt', 'sql', 'ndjson', 'jsonl']);

const MANIFESTS = new Set([
  'package.json', 'tsconfig.json', 'deno.json', 'pyproject.toml', 'setup.py', 'requirements.txt', 'pipfile',
  'go.mod', 'cargo.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'gemfile',
  'composer.json', 'mix.exs', 'pubspec.yaml', 'dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
  'compose.yml', 'compose.yaml', 'makefile', 'render.yaml', 'vercel.json', 'netlify.toml', 'fly.toml',
]);

export const MAX_FILE_BYTES = 200_000;

export type SkipReason = 'ignored-directory' | 'lockfile' | 'binary' | 'generated' | 'sensitive' | 'too-large';

export type PathVerdict = { include: true; priority: number } | { include: false; reason: SkipReason };

function extension(base: string): string {
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1) : '';
}

/** Files whose contents CodeStream never sends to the model; their presence is reported instead. */
export function sensitivity(path: string): 'high' | 'medium' | undefined {
  const base = posix.basename(path).toLowerCase();
  if (/^\.env(\..+)?$/.test(base)) {
    return /\.(example|sample|template|dist|defaults?)$/.test(base) ? undefined : 'high';
  }
  if (/^id_(rsa|dsa|ecdsa|ed25519)$/.test(base) || /\.(pem|key|p12|pfx|jks|keystore|ppk)$/.test(base)) return 'high';
  if (['.npmrc', '.pypirc', '.netrc', '.htpasswd', '.git-credentials'].includes(base)) return 'medium';
  if (/(service[-_]?account|credentials?|secrets?).*\.json$/.test(base)) return 'medium';
  return undefined;
}

export function isTestPath(path: string): boolean {
  return /(^|\/)(__tests__|__mocks__|tests?|spec|e2e|fixtures?|testdata)(\/|$)|\.(test|spec)\.[^/]+$|_test\.(go|py)$/i.test(path);
}

/**
 * Decide from the path alone whether a file is worth sending to the model, and how important it is
 * (0 = read first: docs, manifests and agent instructions; 3 = read last: bulky data files).
 */
export function classifyPath(path: string, size: number): PathVerdict {
  const segments = path.split('/');
  if (segments.slice(0, -1).some((segment) => SKIP_DIRS.has(segment))) return { include: false, reason: 'ignored-directory' };

  const base = (segments.at(-1) ?? '').toLowerCase();
  const ext = extension(base);
  if (sensitivity(path)) return { include: false, reason: 'sensitive' };
  if (LOCKFILES.has(base)) return { include: false, reason: 'lockfile' };
  if (BINARY_EXTENSIONS.has(ext)) return { include: false, reason: 'binary' };
  if (/\.min\.(js|css)$|\.map$|\.snap$|\.pb\.go$|_pb2(_grpc)?\.py$|\.generated\.[a-z]+$|\.svg$/.test(base)) {
    return { include: false, reason: 'generated' };
  }
  if (size > MAX_FILE_BYTES) return { include: false, reason: 'too-large' };

  const depth = segments.length - 1;
  if (MANIFESTS.has(base)) return { include: true, priority: 0 };
  if (depth === 0 && /^(readme|architecture|contributing|agents|claude|gemini|design)(\.[a-z]+)?$/.test(base)) {
    return { include: true, priority: 0 };
  }
  if (DATA_EXTENSIONS.has(ext) && size > 20_000) return { include: true, priority: 3 };
  if (isTestPath(path) || ext === 'md' || ext === 'mdx' || ext === 'rst') return { include: true, priority: 2 };
  return { include: true, priority: 1 };
}

/** Same heuristic as git: a NUL byte in the first 8000 bytes means binary. */
export function looksBinary(data: Buffer): boolean {
  return data.subarray(0, 8000).includes(0);
}
