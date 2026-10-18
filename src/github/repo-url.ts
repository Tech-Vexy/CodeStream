import { InputError } from '../errors.js';

export interface RepoCoordinates {
  owner: string;
  name: string;
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Accepts `owner/repo`, `https://github.com/owner/repo[.git][/tree/...]`,
 * `github.com/owner/repo` and `git@github.com:owner/repo.git`.
 */
export function parseRepoUrl(input: string): RepoCoordinates {
  const text = input.trim();
  let owner: string | undefined;
  let name: string | undefined;

  const ssh = /^git@github\.com:([^/\s]+)\/([^/\s]+?)\/?$/i.exec(text);
  if (ssh) {
    [, owner, name] = ssh;
  } else {
    const path = text.replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '');
    if (/^[a-z][a-z0-9+.-]*:/i.test(path) || /^[^/]+\.[a-z]{2,}\//i.test(path)) {
      throw new InputError(`Only GitHub repositories are supported (got "${input}").`);
    }
    [owner, name] = path.split(/[/?#]/).filter(Boolean);
  }

  name = name?.replace(/\.git$/i, '');
  if (!owner || !name || !OWNER.test(owner) || !NAME.test(name) || name === '.' || name === '..') {
    throw new InputError(`"${input}" is not a GitHub repository. Use owner/repo or https://github.com/owner/repo.`);
  }
  return { owner, name };
}
