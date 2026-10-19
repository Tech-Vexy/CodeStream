/** API response shapes, mirroring src/http/serialize.ts on the server. */

export type CastKind = 'codebase' | 'changes';
export type CastStatus = 'queued' | 'running' | 'ready' | 'failed';

export interface AuthUser {
  id: number;
  login: string;
  name?: string;
  avatarUrl?: string;
}

export interface MeResponse {
  user: AuthUser | null;
  authEnabled: boolean;
}

export interface RepoInfo {
  owner: string;
  name: string;
  fullName: string;
  url: string;
}

export interface CastRequest {
  ref?: string;
  base?: string;
  commitLimit: number;
  audio: boolean;
}

export interface Progress {
  done: number;
  total: number;
}

export interface Risk {
  severity: string;
  title: string;
  detail: string;
  paths: string[];
}

export interface ReportComponent {
  name: string;
  paths: string[];
  responsibility: string;
}

export interface EntryPoint {
  path: string;
  description: string;
}

export interface ReadingOrderItem {
  path: string;
  why: string;
}

export interface Highlight {
  title: string;
  detail: string;
  paths: string[];
}

export interface TimelineItem {
  sha: string;
  summary: string;
}

export interface CodebaseReport {
  title: string;
  tldr: string;
  purpose: string;
  architecture: string;
  techStack: string[];
  components: ReportComponent[];
  dataFlow: string;
  entryPoints: EntryPoint[];
  risks: Risk[];
  readingOrder: ReadingOrderItem[];
  openQuestions: string[];
}

export interface ChangeReport {
  title: string;
  tldr: string;
  overview: string;
  highlights: Highlight[];
  risks: Risk[];
  reviewChecklist: string[];
  testing: string;
  timeline: TimelineItem[];
}

export type Report = CodebaseReport | ChangeReport;

export interface CastSource {
  sha: string;
  branch?: string;
  baseSha?: string;
  description?: string | null;
  commits?: number;
  files?: number;
}

export interface Cast {
  id: string;
  owner: { id: number; login: string };
  kind: CastKind;
  repo: RepoInfo;
  request: CastRequest;
  status: CastStatus;
  stage: string;
  progress?: Progress;
  source?: CastSource;
  report?: Report;
  script?: string;
  hasAudio: boolean;
  warnings: string[];
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface CastSummary {
  id: string;
  kind: CastKind;
  repo: RepoInfo;
  status: CastStatus;
  stage: string;
  progress?: Progress;
  title?: string;
  createdAt: string;
  completedAt?: string;
}

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

/** One persisted question/answer exchange about a cast (the Q&A history). */
export interface QaExchange {
  id: string;
  question: string;
  answer: string;
  citations: string[];
  createdAt: string;
}

export interface CreateCastInput {
  repoUrl: string;
  kind: CastKind;
  ref?: string;
  base?: string;
  commitLimit?: number;
  audio?: boolean;
}
