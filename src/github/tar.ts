const BLOCK = 512;

export interface TarEntry {
  path: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  data: Buffer;
}

function readString(buf: Buffer, start: number, length: number): string {
  const field = buf.subarray(start, start + length);
  const nul = field.indexOf(0);
  return field.subarray(0, nul === -1 ? field.length : nul).toString('utf8');
}

function readNumber(buf: Buffer, start: number, length: number): number {
  const field = buf.subarray(start, start + length);
  if ((field[0] ?? 0) & 0x80) {
    // GNU base-256 encoding for values that do not fit in octal.
    let value = (field[0] ?? 0) & 0x7f;
    for (let i = 1; i < field.length; i++) value = value * 256 + (field[i] ?? 0);
    return value;
  }
  const text = readString(buf, start, length).trim();
  return text ? Number.parseInt(text, 8) : 0;
}

/** Parse pax extended-header records: "<length> <key>=<value>\n". */
function parsePax(data: Buffer): Record<string, string> {
  const records: Record<string, string> = {};
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space === -1) break;
    const length = Number.parseInt(data.toString('utf8', offset, space), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = data.toString('utf8', space + 1, offset + length - 1);
    const eq = record.indexOf('=');
    if (eq > 0) records[record.slice(0, eq)] = record.slice(eq + 1);
    offset += length;
  }
  return records;
}

function isZeroBlock(buf: Buffer, offset: number): boolean {
  for (let i = offset; i < offset + BLOCK; i++) if (buf[i] !== 0) return false;
  return true;
}

/**
 * Minimal reader for uncompressed tar archives as produced by `git archive`
 * (ustar + pax headers, plus GNU long names for good measure).
 */
export function* readTar(archive: Buffer): Generator<TarEntry> {
  let offset = 0;
  let pendingPath: string | undefined;
  let pendingSize: number | undefined;

  while (offset + BLOCK <= archive.length && !isZeroBlock(archive, offset)) {
    const header = archive.subarray(offset, offset + BLOCK);
    const typeflag = String.fromCharCode(header[156] ?? 0);
    const isMeta = typeflag === 'x' || typeflag === 'g' || typeflag === 'L' || typeflag === 'K';

    let size = readNumber(header, 124, 12);
    if (!isMeta && pendingSize !== undefined) size = pendingSize;

    const dataStart = offset + BLOCK;
    if (dataStart + size > archive.length) throw new Error('Truncated tar archive');
    const data = archive.subarray(dataStart, dataStart + size);
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (typeflag === 'x') {
      const pax = parsePax(data);
      if (pax.path !== undefined) pendingPath = pax.path;
      if (pax.size !== undefined) pendingSize = Number(pax.size);
      continue;
    }
    if (typeflag === 'L') {
      pendingPath = readString(data, 0, data.length);
      continue;
    }
    if (typeflag === 'g' || typeflag === 'K') continue;

    let path = readString(header, 0, 100);
    if (header.toString('latin1', 257, 263) === 'ustar\0') {
      const prefix = readString(header, 345, 155);
      if (prefix) path = `${prefix}/${path}`;
    }
    if (pendingPath !== undefined) path = pendingPath;
    pendingPath = undefined;
    pendingSize = undefined;

    const type =
      typeflag === '0' || typeflag === '\0' || typeflag === '7'
        ? 'file'
        : typeflag === '5'
          ? 'directory'
          : typeflag === '2'
            ? 'symlink'
            : 'other';
    yield { path, type, data };
  }
}
