interface DirNode {
  dirs: Map<string, DirNode>;
  files: string[];
  total: number;
}

function newDir(): DirNode {
  return { dirs: new Map(), files: [], total: 0 };
}

function buildTree(paths: string[]): { root: DirNode; maxDepth: number } {
  const root = newDir();
  let maxDepth = 1;
  for (const path of paths) {
    const parts = path.split('/');
    maxDepth = Math.max(maxDepth, parts.length);
    let node = root;
    node.total++;
    for (const dir of parts.slice(0, -1)) {
      let child = node.dirs.get(dir);
      if (!child) {
        child = newDir();
        node.dirs.set(dir, child);
      }
      child.total++;
      node = child;
    }
    node.files.push(parts.at(-1) ?? path);
  }
  return { root, maxDepth };
}

function renderDir(node: DirNode, depthLimit: number, depth: number, lines: string[]): void {
  const indent = '  '.repeat(depth);
  for (const [name, child] of [...node.dirs].sort(([a], [b]) => a.localeCompare(b))) {
    if (depth + 1 >= depthLimit) {
      lines.push(`${indent}${name}/ (${child.total} files)`);
    } else {
      lines.push(`${indent}${name}/`);
      renderDir(child, depthLimit, depth + 1, lines);
    }
  }
  for (const file of [...node.files].sort((a, b) => a.localeCompare(b))) lines.push(`${indent}${file}`);
}

/**
 * Render an indented directory tree, collapsing the deepest levels into "dir/ (N files)"
 * until it fits in `maxLines`.
 */
export function renderTree(paths: string[], maxLines = 250): string {
  if (paths.length === 0) return '(empty)';
  const { root, maxDepth } = buildTree(paths);
  let lines: string[] = [];
  for (let depthLimit = maxDepth; depthLimit >= 1; depthLimit--) {
    lines = [];
    renderDir(root, depthLimit, 0, lines);
    if (lines.length <= maxLines) return lines.join('\n');
  }
  return `${lines.slice(0, maxLines).join('\n')}\n… (${lines.length - maxLines} more entries)`;
}
