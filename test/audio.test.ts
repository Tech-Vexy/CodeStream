import { describe, expect, it } from 'vitest';
import { splitForSpeech } from '../src/audio/segments.js';

describe('speech segmentation', () => {
  it('keeps every segment within the provider limit', () => {
    const script = [
      'The first paragraph explains the architecture. It has enough words to force a split.',
      'The second paragraph explains the risks and the review order.',
    ].join('\n\n');

    const segments = splitForSpeech(script, 40);

    expect(segments.length).toBeGreaterThan(1);
    expect(segments.every((segment) => segment.length <= 40)).toBe(true);
    expect(segments.join('\n\n')).toContain('first paragraph');
    expect(segments.join('\n\n')).toContain('second paragraph');
  });

  it('hard-wraps a single word longer than the limit', () => {
    expect(splitForSpeech('a'.repeat(11), 4)).toEqual(['aaaa', 'aaaa', 'aaa']);
  });

  it('normalizes whitespace and ignores empty paragraphs', () => {
    expect(splitForSpeech('  One   sentence.  \n\n\n  Two sentences.  ', 100)).toEqual(['One sentence.\n\nTwo sentences.']);
  });
});
