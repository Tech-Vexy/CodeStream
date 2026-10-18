import { ElevenLabsClient, ElevenLabsError } from '@elevenlabs/elevenlabs-js';
import { ConfigError } from '../errors.js';
import { splitForSpeech } from './segments.js';

export interface SpeechResult {
  audio: Buffer;
  contentType: string;
  segments: number;
}

export interface SpeechSynthesizer {
  synthesize(script: string): Promise<SpeechResult>;
}

export interface ElevenLabsOptions {
  apiKey: string;
  voiceId: string;
  modelId: string;
  /** Characters per request. 4,500 stays under every current model's limit (Eleven v3 caps at 5,000). */
  maxCharsPerRequest?: number;
}

const CONTEXT_CHARS = 500;

export class ElevenLabsNarrator implements SpeechSynthesizer {
  private readonly client: ElevenLabsClient;

  constructor(private readonly options: ElevenLabsOptions) {
    this.client = new ElevenLabsClient({ apiKey: options.apiKey });
  }

  async synthesize(script: string): Promise<SpeechResult> {
    const segments = splitForSpeech(script, this.options.maxCharsPerRequest ?? 4_500);
    const parts: Buffer[] = [];
    for (const [i, text] of segments.entries()) {
      const previous = segments[i - 1];
      const next = segments[i + 1];
      try {
        const stream = await this.client.textToSpeech.convert(this.options.voiceId, {
          text,
          modelId: this.options.modelId,
          outputFormat: 'mp3_44100_128',
          // Neighbouring text keeps intonation continuous across segment boundaries.
          ...(previous ? { previousText: previous.slice(-CONTEXT_CHARS) } : {}),
          ...(next ? { nextText: next.slice(0, CONTEXT_CHARS) } : {}),
        });
        const chunks: Uint8Array[] = [];
        for await (const chunk of stream) chunks.push(chunk);
        parts.push(Buffer.concat(chunks));
      } catch (err) {
        // 4xx other than 429 will fail the same way on every retry: bad key, voice, model or quota.
        const status = err instanceof ElevenLabsError ? err.statusCode : undefined;
        if (status !== undefined && status >= 400 && status < 500 && status !== 429) {
          throw new ConfigError(
            `ElevenLabs rejected the request (${status}): ${err instanceof Error ? err.message : String(err)}. Check ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL_ID and your plan's quota.`,
          );
        }
        throw err;
      }
    }
    // MP3 frames are self-delimiting, so segments concatenate into one playable file.
    return { audio: Buffer.concat(parts), contentType: 'audio/mpeg', segments: segments.length };
  }
}
