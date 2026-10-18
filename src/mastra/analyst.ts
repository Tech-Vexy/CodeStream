import type { AgentName, CodestreamMastra } from './agents.js';
import {
  answerPrompt,
  changeChunkPrompt,
  changeReportPrompt,
  cleanScript,
  codebaseChunkPrompt,
  codebaseReportPrompt,
  condensePrompt,
  scriptPrompt,
} from './prompts.js';
import { changeReportSchema, codebaseReportSchema, type ChangeReport, type CodebaseReport } from './schemas.js';

const NOTE_WORDS = 350;
const CONDENSED_WORDS = 600;

// Gemma 4 on the Gemini API toggles thinking with thinkingLevel "minimal" (off) or "high" (on).
// Other providers ignore the `google` options, so a different CODESTREAM_MODEL still works.
const fast = { google: { thinkingConfig: { thinkingLevel: 'minimal' as const } } };
const careful = { google: { thinkingConfig: { thinkingLevel: 'high' as const } } };

/** The model-facing operations of a cast. Each method is one Mastra agent call. */
export class Analyst {
  constructor(private readonly mastra: CodestreamMastra) {}

  private async text(agent: AgentName, prompt: string, temperature = 0.2): Promise<string> {
    const result = await this.mastra.getAgent(agent).generate(prompt, {
      modelSettings: { temperature, maxOutputTokens: 4096 },
      providerOptions: fast,
    });
    const text = result.text.trim();
    if (!text) throw new Error(`The ${agent} agent returned an empty response.`);
    return text;
  }

  codeNotes(args: { repo: string; sha: string; part: number; parts: number; content: string }): Promise<string> {
    return this.text('codebaseAnalyst', codebaseChunkPrompt({ ...args, words: NOTE_WORDS }));
  }

  changeNotes(args: { repo: string; part: number; parts: number; content: string }): Promise<string> {
    return this.text('changeReviewer', changeChunkPrompt({ ...args, words: NOTE_WORDS }));
  }

  condense(kind: 'codebase' | 'changes', repo: string, notes: string): Promise<string> {
    return this.text(kind === 'codebase' ? 'codebaseAnalyst' : 'changeReviewer', condensePrompt({ repo, notes, words: CONDENSED_WORDS }));
  }

  async codebaseReport(args: Parameters<typeof codebaseReportPrompt>[0]): Promise<CodebaseReport> {
    const result = await this.mastra.getAgent('codebaseAnalyst').generate(codebaseReportPrompt(args), {
      modelSettings: { temperature: 0.2, maxOutputTokens: 16_384 },
      providerOptions: careful,
      // Prompt-injected JSON works with any model; Mastra strips code fences and validates the schema.
      structuredOutput: { schema: codebaseReportSchema, jsonPromptInjection: 'inline' },
    });
    return codebaseReportSchema.parse(result.object);
  }

  async changeReport(args: Parameters<typeof changeReportPrompt>[0]): Promise<ChangeReport> {
    const result = await this.mastra.getAgent('changeReviewer').generate(changeReportPrompt(args), {
      modelSettings: { temperature: 0.2, maxOutputTokens: 16_384 },
      providerOptions: careful,
      structuredOutput: { schema: changeReportSchema, jsonPromptInjection: 'inline' },
    });
    return changeReportSchema.parse(result.object);
  }

  async script(args: { kind: 'codebase' | 'changes'; repo: string; report: CodebaseReport | ChangeReport }): Promise<string> {
    const words = args.kind === 'codebase' ? 700 : 600;
    return cleanScript(await this.text('narrator', scriptPrompt({ ...args, words }), 0.6));
  }

  /** One grounded answer to a developer question about a cast. */
  async answer(args: { kind: 'codebase' | 'changes'; repo: string; question: string; passages: string }): Promise<string> {
    // Use the same agent that produced the cast so the system-prompt framing matches the domain:
    // codebaseAnalyst for tour casts, changeReviewer for commit-range casts.
    // The answerPrompt itself constrains the model to reply strictly from the retrieved passages.
    const agent = args.kind === 'codebase' ? 'codebaseAnalyst' : 'changeReviewer';
    return this.text(agent, answerPrompt(args), 0.2);
  }
}
