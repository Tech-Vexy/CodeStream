/** A unit of model input (one file or one commit) that may be split across chunks if too large. */
export interface Block {
  /** Short heading such as "FILE src/app.ts"; repeated with part info when the block is split. */
  label: string;
  body: string;
  /** What this block covers: file paths or commit SHAs. */
  refs: string[];
}

export interface Chunk {
  index: number;
  refs: string[];
  content: string;
}

function header(label: string, part?: { index: number; count: number; first: number; last: number }): string {
  return part ? `=== ${label} (part ${part.index}/${part.count}, lines ${part.first}-${part.last}) ===` : `=== ${label} ===`;
}

function hardWrap(line: string, width: number): string[] {
  if (line.length <= width) return [line];
  const pieces: string[] = [];
  for (let i = 0; i < line.length; i += width) pieces.push(line.slice(i, i + width));
  return pieces;
}

/** Render a block as one or more strings, each at most `maxChars` long. */
export function splitBlock(block: Block, maxChars: number): string[] {
  const whole = `${header(block.label)}\n${block.body}`;
  if (whole.length <= maxChars) return [whole];

  const budget = Math.max(200, maxChars - header(block.label, { index: 999, count: 999, first: 9_999_999, last: 9_999_999 }).length - 1);
  const pieces: Array<{ lines: string[]; first: number; last: number; size: number }> = [];
  let current: (typeof pieces)[number] | undefined;

  block.body.split('\n').forEach((line, i) => {
    const lineNo = i + 1;
    for (const segment of hardWrap(line, budget - 1)) {
      if (current && current.size + segment.length + 1 > budget) {
        pieces.push(current);
        current = undefined;
      }
      current ??= { lines: [], first: lineNo, last: lineNo, size: 0 };
      current.lines.push(segment);
      current.last = lineNo;
      current.size += segment.length + 1;
    }
  });
  if (current) pieces.push(current);

  return pieces.map(
    (piece, k) =>
      `${header(block.label, { index: k + 1, count: pieces.length, first: piece.first, last: piece.last })}\n${piece.lines.join('\n')}`,
  );
}

/** Greedily pack blocks, in order, into chunks of at most `maxChars` characters. */
export function packBlocks(blocks: Block[], maxChars: number): Chunk[] {
  const chunks: Chunk[] = [];
  let parts: string[] = [];
  let refs = new Set<string>();
  let size = 0;

  const flush = () => {
    if (parts.length === 0) return;
    chunks.push({ index: chunks.length, refs: [...refs], content: parts.join('\n\n') });
    parts = [];
    refs = new Set();
    size = 0;
  };

  for (const block of blocks) {
    for (const piece of splitBlock(block, maxChars)) {
      if (size > 0 && size + piece.length + 2 > maxChars) flush();
      parts.push(piece);
      for (const ref of block.refs) refs.add(ref);
      size += piece.length + 2;
    }
  }
  flush();
  return chunks;
}
