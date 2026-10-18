import { ElevenLabs, ElevenLabsClient, ElevenLabsError } from '@elevenlabs/elevenlabs-js';
import type { CastDoc } from '../domain.js';
import { ConfigError } from '../errors.js';
import type { ChangeReport, CodebaseReport } from '../mastra/schemas.js';
import { splitForSpeech } from './segments.js';

export interface SpeechResult {
  audio: Buffer;
  contentType: string;
  segments: number;
}

export interface SpeechSynthesizer {
  synthesize(script: string): Promise<SpeechResult>;
}

export interface VoiceAgentSession {
  signedUrl: string;
  agentId: string;
}

export interface VoiceAgentService {
  syncAgent(cast: CastDoc): Promise<{ agentId: string }>;
  createSession(cast: CastDoc): Promise<VoiceAgentSession>;
}

export interface ElevenLabsOptions {
  apiKey: string;
  voiceId: string;
  modelId: string;
  agentVoiceId?: string;
  agentTtsModel?: string;
  agentLlm?: string;
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

function formatGemmaSummary(cast: CastDoc): string {
  const { report, repo, kind, source } = cast;
  if (!report) return `Repository: ${repo.fullName} (No analysis report available).`;

  if (kind === 'codebase') {
    const r = report as CodebaseReport;
    return [
      `Repository: ${repo.fullName}`,
      `Ref: ${source?.branch || source?.sha || 'default'}`,
      `Title: ${r.title}`,
      `TL;DR:\n${r.tldr}`,
      `Purpose:\n${r.purpose}`,
      `Architecture:\n${r.architecture}`,
      r.techStack?.length ? `Tech Stack: ${r.techStack.join(', ')}` : '',
      `Key Entry Points & Components:\n${r.entryPoints.map((e) => `- ${e.path}: ${e.description}`).join('\n')}`,
      `Security & Code Risks:\n${r.risks.map((risk) => `- [${risk.severity.toUpperCase()}] ${risk.title}: ${risk.detail} (Files: ${risk.paths.join(', ')})`).join('\n')}`,
      r.readingOrder?.length ? `Recommended Reading Order:\n${r.readingOrder.map((ro) => `- ${ro.path}: ${ro.why}`).join('\n')}` : '',
      r.openQuestions?.length ? `Open Architectural Questions:\n${r.openQuestions.map((q) => `- ${q}`).join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  } else {
    const r = report as ChangeReport;
    return [
      `Repository: ${repo.fullName}`,
      `Range: ${source?.commits ? `${source.commits} commits` : 'recent commits'}`,
      `Title: ${r.title}`,
      `TL;DR:\n${r.tldr}`,
      `What Changed:\n${r.overview}`,
      `Key Highlights:\n${r.highlights.map((h) => `- ${h.title}: ${h.detail} (Files: ${h.paths.join(', ')})`).join('\n')}`,
      `Security & Change Risks:\n${r.risks.map((risk) => `- [${risk.severity.toUpperCase()}] ${risk.title}: ${risk.detail} (Files: ${risk.paths.join(', ')})`).join('\n')}`,
      r.reviewChecklist?.length ? `Review Checklist:\n${r.reviewChecklist.map((c) => `- [ ] ${c}`).join('\n')}` : '',
      r.testing ? `Testing Notes:\n${r.testing}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }
}

export class ElevenLabsVoiceAgentManager implements VoiceAgentService {
  private readonly client: ElevenLabsClient;

  constructor(private readonly options: ElevenLabsOptions) {
    this.client = new ElevenLabsClient({ apiKey: options.apiKey });
  }

  async syncAgent(cast: CastDoc): Promise<{ agentId: string }> {
    if (!cast.report) throw new Error(`Cast ${cast._id} has no report to sync to ElevenLabs.`);
    const summary = formatGemmaSummary(cast);
    const agentName = `CodeStream · ${cast.repo.fullName}`.slice(0, 64);

    const promptText = [
      `You are the interactive CodeStream voice briefing agent for the repository "${cast.repo.fullName}".`,
      `A thorough technical analysis was conducted by Google Gemma 4. Below is Gemma's full codebase briefing summary:`,
      '',
      '=== GEMMA ANALYSIS SUMMARY ===',
      summary,
      '==============================',
      '',
      'CRITICAL INSTRUCTIONS:',
      '1. High-level questions: Answer directly, clearly, concisely, and technically based on Gemma\'s summary above.',
      '2. In-depth code questions: Whenever the developer asks about specific file implementations, functions, algorithms, commits, code mechanics, or dependencies not fully covered above, YOU MUST CALL THE "gemma_code_analyser" TOOL.',
      '3. Never hallucinate or guess file contents or function signatures. Always query Gemma with "gemma_code_analyser" for authoritative answers.',
      '4. Speak naturally, professionally, and concisely as a senior staff engineer pairing with the developer.',
    ].join('\n');

    const firstMessage =
      `Hello! I'm your CodeStream briefing agent for ${cast.repo.fullName}. Gemma just analyzed the repository. Would you like a walkthrough of the architecture, an explanation of the risks, or do you have any code questions?`;

    const conversationConfig: ElevenLabs.ConversationalConfig = {
      agent: {
        firstMessage,
        prompt: {
          prompt: promptText,
          llm: (this.options.agentLlm ?? 'gemini-3.8-flash') as ElevenLabs.Llm,
          tools: [
            {
              type: 'client',
              name: 'gemma_code_analyser',
              description:
                'Invokes Google Gemma 4 to analyze the repository code, inspect functions and files, examine commit diffs, or answer technical questions grounded strictly in the codebase.',
              parameters: {
                type: 'object',
                properties: {
                  question: {
                    type: 'string',
                    description: 'The technical question or query to analyze with Google Gemma 4 about the codebase or changes.',
                  },
                },
                required: ['question'],
              },
              expectsResponse: true,
            },
          ],
        },
      },
      tts: {
        voiceId: this.options.agentVoiceId ?? this.options.voiceId,
        modelId: (this.options.agentTtsModel ?? 'eleven_turbo_v2_5') as ElevenLabs.TtsConversationalModel,
      },
    };

    try {
      if (cast.elevenAgent?.agentId) {
        try {
          await this.client.conversationalAi.agents.update(cast.elevenAgent.agentId, {
            name: agentName,
            conversationConfig,
          });
          return { agentId: cast.elevenAgent.agentId };
        } catch (updateErr) {
          const status = updateErr instanceof ElevenLabsError ? updateErr.statusCode : undefined;
          if (status !== 404) throw updateErr;
        }
      }

      const res = await this.client.conversationalAi.agents.create({
        name: agentName,
        conversationConfig,
      });
      return { agentId: res.agentId };
    } catch (err) {
      const status = err instanceof ElevenLabsError ? err.statusCode : undefined;
      if (status !== undefined && status >= 400 && status < 500 && status !== 429) {
        throw new ConfigError(
          `ElevenLabs Conversational AI rejected the agent request (${status}): ${err instanceof Error ? err.message : String(err)}. Check ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, and your plan's Conversational AI features.`,
        );
      }
      throw err;
    }
  }

  async createSession(cast: CastDoc): Promise<VoiceAgentSession> {
    let agentId = cast.elevenAgent?.agentId;
    if (!agentId) {
      const synced = await this.syncAgent(cast);
      agentId = synced.agentId;
    }

    try {
      const response = await this.client.conversationalAi.conversations.getSignedUrl({ agentId });
      return { signedUrl: response.signedUrl, agentId };
    } catch (err) {
      const status = err instanceof ElevenLabsError ? err.statusCode : undefined;
      if (status !== undefined && status >= 400 && status < 500 && status !== 429) {
        throw new ConfigError(
          `ElevenLabs could not create a conversation session (${status}): ${err instanceof Error ? err.message : String(err)}. Check ELEVENLABS_API_KEY.`,
        );
      }
      throw err;
    }
  }
}
