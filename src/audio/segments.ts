function pack(pieces: string[], maxChars: number, joiner: string): string[] {
  const out: string[] = [];
  let current = '';
  for (const piece of pieces) {
    const candidate = current ? `${current}${joiner}${piece}` : piece;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) out.push(current);
      current = piece;
    }
  }
  if (current) out.push(current);
  return out;
}

function splitLong(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const sentences = text.match(/[^.!?]+(?:[.!?]+["')\]]*|$)\s*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  const words = sentences.flatMap((sentence) => (sentence.length <= maxChars ? [sentence] : pack(sentence.split(/\s+/), maxChars, ' ')));
  return pack(words, maxChars, ' ').flatMap((piece) =>
    piece.length <= maxChars ? [piece] : Array.from({ length: Math.ceil(piece.length / maxChars) }, (_, i) => piece.slice(i * maxChars, (i + 1) * maxChars)),
  );
}

/**
 * Split a narration script into segments of at most `maxChars`, breaking at paragraphs, then sentences,
 * then words, so each text-to-speech request stays under the model's character limit.
 */
export function splitForSpeech(script: string, maxChars: number): string[] {
  const paragraphs = script
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .flatMap((paragraph) => splitLong(paragraph, maxChars));
  return pack(paragraphs, maxChars, '\n\n');
}
