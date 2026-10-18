import type { ObjectId } from 'mongodb';
import type { ChangeSet } from './ingest/changes.js';
import type { CodebaseSnapshot } from './ingest/codebase.js';
import type { ChangeReport, CodebaseReport } from './mastra/schemas.js';

export type CastKind = 'codebase' | 'changes';
export type CastStatus = 'queued' | 'running' | 'ready' | 'failed';

export interface RepoInfo {
  owner: string;
  name: string;
  fullName: string;
  url: string;
}

export interface CastRequest {
  ref?: string;
  /** Changes only: analyze `base...ref` instead of the last `commitLimit` commits. */
  base?: string;
  commitLimit: number;
  audio: boolean;
}

export interface CastDoc {
  _id: string;
  owner: { id: number; login: string };
  /** Encrypted GitHub OAuth access token; empty when the worker uses its configured global token. */
  githubToken: string;
  kind: CastKind;
  repo: RepoInfo;
  request: CastRequest;
  status: CastStatus;
  stage: string;
  progress?: { done: number; total: number };
  workflowId: string;
  source?: {
    sha: string;
    branch?: string;
    baseSha?: string;
    description?: string | null;
    commits?: number;
    files?: number;
  };
  report?: CodebaseReport | ChangeReport;
  script?: string;
  audio?: { fileId: ObjectId; bytes: number; contentType: string };
  /** ElevenAgents (Conversational AI) agent that answers spoken questions about this cast. */
  elevenAgent?: { agentId: string; createdAt: Date };
  warnings: string[];
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

/** One model-sized slice of source or diffs, plus the notes Gemma wrote about it. */
export interface ChunkDoc {
  _id: string;
  castId: string;
  index: number;
  refs: string[];
  content: string;
  notes?: string;
  createdAt: Date;
}

/** Everything the synthesis step needs besides the chunk notes. Expires with the chunks. */
export type ContextDoc =
  | ({ _id: string; kind: 'codebase'; createdAt: Date } & Omit<CodebaseSnapshot, 'chunks'>)
  | ({ _id: string; kind: 'changes'; createdAt: Date; rangeNote?: string } & Omit<ChangeSet, 'blocks'>);

export interface WorkflowInput {
  castId: string;
  kind: CastKind;
  audio: boolean;
  /** How many chunk summaries run in parallel (keep low for free-tier Gemma rate limits). */
  concurrency: number;
}

/** One question to answer about a finished cast (POST /api/casts/:id/qa). */
export interface QaInput {
  castId: string;
  question: string;
}

/** The answer a qaWorkflow returns to the API (Temporal payloads are JSON, so dates are ISO strings). */
export interface QaAnswer {
  id?: string;
  answer: string;
  citations: string[];
  createdAt?: string;
}

/** A repository owned by or shared with the signed-in user (GET /api/repos). */
export interface RepoSummary {
  fullName: string;
  htmlUrl: string;
  description: string | null;
  defaultBranch: string;
  isPrivate: boolean;
  language: string | null;
  stars: number;
  pushedAt: string | null;
}

/** One embedded passage of a cast, used for retrieval over stored codebase knowledge. */
export interface EmbeddingDoc {
  _id: string;
  castId: string;
  index: number;
  refs: string[];
  text: string;
  vector: number[];
  model: string;
  createdAt: Date;
}

/** One persisted question/answer exchange about a cast (the Q&A history). */
export interface QaDoc {
  _id: string;
  castId: string;
  question: string;
  answer: string;
  citations: string[];
  createdAt: Date;
}
