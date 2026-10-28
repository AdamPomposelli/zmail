export type TreeInput = { id: string; messageId: string | null; inReplyTo: string | null; references: string[]; date: number };

export type TreeNode = {
  id: string;
  /** The message this one answers, when it is in the conversation. */
  parentId: string | null;
  depth: number;
  /** Last child of its parent: its branch ends here (└ rather than ├). */
  last: boolean;
  /** One entry per ancestor level (1…depth-1): true when a vertical line continues through it. */
  guides: boolean[];
};

/**
 * Who answers whom in one conversation, as Thunderbird/Betterbird draw it: the parent is the
 * message named by In-Reply-To, else the closest one in References that is in the conversation.
 * Returns the nodes in reading order (depth first, each level by date).
 */
export function buildReplyTree(messages: TreeInput[]): TreeNode[] {
  const byMessageId = new Map<string, TreeInput>();
  for (const m of messages) if (m.messageId && !byMessageId.has(m.messageId)) byMessageId.set(m.messageId, m);

  const parentOf = new Map<string, string | null>();
  for (const m of messages) {
    const candidates = [m.inReplyTo, ...[...m.references].reverse()];
    const parent = candidates.map((id) => (id ? byMessageId.get(id) : undefined)).find((p) => p && p.id !== m.id);
    parentOf.set(m.id, parent?.id ?? null);
  }
  // Broken headers can loop (A answers B answers A): cut the loop at the message seen again.
  for (const m of messages) {
    const seen = new Set([m.id]);
    for (let p = parentOf.get(m.id); p; p = parentOf.get(p) ?? null) {
      if (seen.has(p)) {
        parentOf.set(m.id, null);
        break;
      }
      seen.add(p);
    }
  }

  const children = new Map<string | null, TreeInput[]>();
  for (const m of messages) {
    const key = parentOf.get(m.id) ?? null;
    children.set(key, [...(children.get(key) ?? []), m]);
  }
  for (const list of children.values()) list.sort((a, b) => a.date - b.date);

  const out: TreeNode[] = [];
  const walk = (parentId: string | null, depth: number, guides: boolean[]) => {
    const list = children.get(parentId) ?? [];
    list.forEach((m, i) => {
      const last = i === list.length - 1;
      out.push({ id: m.id, parentId, depth, last, guides });
      walk(m.id, depth + 1, depth === 0 ? [] : [...guides, !last]);
    });
  };
  walk(null, 0, []);
  return out;
}

/**
 * Groups messages into conversations from their headers alone (union-find over Message-ID,
 * In-Reply-To and References). Used to repair conversations split because a reply was synced
 * before the mail it answers.
 */
export function groupConversations(messages: { id: string; messageId: string | null; inReplyTo: string | null; references: string[] }[]) {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    for (let n = x; n !== root; ) {
      const next = parent.get(n)!;
      parent.set(n, root);
      n = next;
    }
    return root;
  };
  const add = (x: string) => (parent.has(x) ? x : (parent.set(x, x), x));
  const union = (a: string, b: string) => {
    const ra = find(add(a));
    const rb = find(add(b));
    if (ra !== rb) parent.set(rb, ra);
  };
  for (const m of messages) {
    const self = `row:${m.id}`;
    add(self);
    for (const ref of [m.messageId, m.inReplyTo, ...m.references]) if (ref) union(self, `mid:${ref}`);
  }
  const groups = new Map<string, string[]>();
  for (const m of messages) {
    const root = find(`row:${m.id}`);
    groups.set(root, [...(groups.get(root) ?? []), m.id]);
  }
  return [...groups.values()];
}
