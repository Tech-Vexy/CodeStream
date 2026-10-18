import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseRepoUrl } from '../src/github/repo-url.js';
import { buildChangeSet } from '../src/ingest/changes.js';
import { buildSnapshot, filesFromTarball } from '../src/ingest/codebase.js';
import type { GitHubCommitDetail } from '../src/github/client.js';

function tarHeader(path: string, size: number, type = '0'): Buffer {
  const header = Buffer.alloc(512);
  header.write(path, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  header.write('00000000000\0', 136, 12, 'ascii');
  header.fill(' ', 148, 156);
  header.write(type, 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  return header;
}

function makeTar(files: Array<[string, string]>): Buffer {
  const entries = files.flatMap(([path, text]) => {
    const data = Buffer.from(text);
    const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
    return [tarHeader(path, data.length, path.endsWith('/') ? '5' : '0'), data, padding];
  });
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
}

describe('repository ingestion', () => {
  it.each([
    ['owner/repo.git', { owner: 'owner', name: 'repo' }],
    ['https://github.com/owner/repo/tree/main', { owner: 'owner', name: 'repo' }],
    ['git@github.com:owner/repo.git', { owner: 'owner', name: 'repo' }],
  ])('parses %s', (input, expected) => {
    expect(parseRepoUrl(input)).toEqual(expected);
  });

  it('rejects non-GitHub repositories', () => {
    expect(() => parseRepoUrl('https://gitlab.com/owner/repo')).toThrow(/Only GitHub repositories/);
  });

  it('extracts files from a GitHub tarball and removes its root folder', () => {
    const files = filesFromTarball(makeTar([
      ['owner-repo-sha/src/index.ts', 'export const answer = 42;'],
      ['owner-repo-sha/docs/', ''],
    ]), 10_000);

    expect(files).toEqual([{ path: 'src/index.ts', data: Buffer.from('export const answer = 42;') }]);
  });

  it('keeps manifests, omits sensitive files, and enforces the source budget', () => {
    const snapshot = buildSnapshot([
      { path: 'package.json', data: Buffer.from('{}') },
      { path: '.env', data: Buffer.from('TOKEN=secret') },
      { path: 'src/first.ts', data: Buffer.from('a'.repeat(20)) },
      { path: 'src/second.ts', data: Buffer.from('b'.repeat(20)) },
    ], { maxChars: 30, chunkChars: 1_000 });

    expect(snapshot.sensitiveFiles).toEqual([{ path: '.env', severity: 'high' }]);
    expect(snapshot.stats.skipped.sensitive).toBe(1);
    expect(snapshot.stats.includedFiles).toBe(2);
    expect(snapshot.omittedPaths).toEqual(['src/second.ts']);
    expect(snapshot.chunks).toHaveLength(1);
  });
});

describe('change ingestion', () => {
  it('allocates diff budget newest-first while retaining chronological blocks', () => {
    const details: GitHubCommitDetail[] = [1, 2, 3].map((number) => ({
      sha: `sha-${number}`,
      message: `commit ${number}`,
      author: 'author',
      date: `2026-01-0${number}`,
      parents: ['parent'],
      additions: 1,
      deletions: 0,
      files: [{
        path: `src/${number}.ts`,
        status: 'modified',
        additions: 1,
        deletions: 0,
        patch: `@@ -1 +1 @@\n-${'x'.repeat(20)}\n+${'y'.repeat(20)}`,
      }],
    }));

    const changeSet = buildChangeSet(details, { maxPatchChars: 1_000, maxTotalChars: 100 });

    expect(changeSet.blocks.map((block) => block.refs)).toEqual([['sha-1'], ['sha-2'], ['sha-3']]);
    expect(changeSet.stats.patchesOmitted).toBe(2);
    expect(changeSet.blocks[2]?.body).toContain('@@ -1 +1 @@');
  });
});
