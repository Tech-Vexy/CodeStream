import { z } from 'zod/v4';

// Schemas are deliberately forgiving (plain strings, defaulted arrays): a 31B open model occasionally
// capitalizes an enum or drops an empty list, and that should not cost a whole retry.

const list = <T extends z.ZodType>(item: T, description: string) => z.array(item).default([]).describe(description);

export const riskSchema = z.object({
  severity: z.string().describe('Exactly one of: high, medium, low'),
  title: z.string().describe('Short name for the problem'),
  detail: z.string().describe('What is wrong, where, and why it matters. Concrete, one to three sentences.'),
  paths: list(z.string(), 'Files involved'),
});

export const codebaseReportSchema = z.object({
  title: z.string().describe('Project name and a short tagline, e.g. "Acme API: billing backend for Acme Cloud"'),
  tldr: z.string().describe('Two or three sentences a busy developer can read in ten seconds'),
  purpose: z.string().describe('What the software does and who it is for'),
  architecture: z.string().describe('How the code is organized and how the main pieces interact (one or two paragraphs)'),
  techStack: list(z.string(), 'Languages, frameworks, services and notable libraries'),
  components: list(
    z.object({
      name: z.string(),
      paths: list(z.string(), 'Files or folders'),
      responsibility: z.string(),
    }),
    'The main modules, most important first',
  ),
  dataFlow: z.string().describe('How a typical request, job or command moves through the system'),
  entryPoints: list(z.object({ path: z.string(), description: z.string() }), 'Where execution starts: servers, CLIs, workers, jobs'),
  risks: list(riskSchema, 'Concrete problems worth a human look, most severe first'),
  readingOrder: list(z.object({ path: z.string(), why: z.string() }), 'Files a reviewer should read first, in order'),
  openQuestions: list(z.string(), 'Things that look unfinished, stubbed or unclear'),
});

export const changeReportSchema = z.object({
  title: z.string().describe('Headline for the change set, e.g. "Stripe checkout lands, auth middleware rewritten"'),
  tldr: z.string().describe('Two or three sentences a busy developer can read in ten seconds'),
  overview: z.string().describe('What changed overall and why it matters (one or two paragraphs)'),
  highlights: list(
    z.object({ title: z.string(), detail: z.string(), paths: list(z.string(), 'Files involved') }),
    'The most important changes, most important first',
  ),
  risks: list(riskSchema, 'Concrete problems introduced or exposed by these commits, most severe first'),
  reviewChecklist: list(z.string(), 'Specific things the developer should verify before trusting these changes'),
  testing: z.string().describe('Which tests were added, changed or removed, and what remains untested'),
  timeline: list(z.object({ sha: z.string().describe('7-character SHA'), summary: z.string() }), 'One entry per commit, oldest first'),
});

export type Risk = z.infer<typeof riskSchema>;
export type CodebaseReport = z.infer<typeof codebaseReportSchema>;
export type ChangeReport = z.infer<typeof changeReportSchema>;

const SEVERITIES = ['high', 'medium', 'low'] as const;
export type Severity = (typeof SEVERITIES)[number];

export function normalizeSeverity(value: string): Severity {
  const lower = value.trim().toLowerCase();
  if (lower === 'critical' || lower === 'severe') return 'high';
  if (lower === 'moderate') return 'medium';
  if (lower === 'minor' || lower === 'info') return 'low';
  return (SEVERITIES as readonly string[]).includes(lower) ? (lower as Severity) : 'medium';
}

/** Normalize severities and order risks most severe first. */
export function tidyRisks(risks: Risk[]): Risk[] {
  const rank = { high: 0, medium: 1, low: 2 };
  return risks
    .map((risk) => ({ ...risk, severity: normalizeSeverity(risk.severity) }))
    .sort((a, b) => rank[a.severity] - rank[b.severity]);
}
