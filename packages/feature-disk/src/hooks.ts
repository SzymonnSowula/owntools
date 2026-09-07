import { useEffect, useRef, useState } from "react";
import { backend } from "./api";
import type { Breakdown, NodeInfo, TopFilesQuery, TreeNode } from "./api/types";
import { useDiskStore } from "./store";

/**
 * Data hooks over the backend. Every one re-fetches when `dataVersion`
 * changes (a new scan, a cleanup) and ignores answers that arrive after the
 * inputs moved on. Small per-version caches keep the treemap from asking
 * for the same subtree twice while the user hops around.
 */

const nodeCache = new Map<string, NodeInfo | null>();
const subtreeCache = new Map<string, TreeNode | null>();

function key(version: number, ...parts: (string | number)[]): string {
  return `${version}|${parts.join("|")}`;
}

/** A node's info, cached per data version. */
export function useNode(id: number | null): NodeInfo | null {
  const version = useDiskStore((s) => s.dataVersion);
  const [node, setNode] = useState<NodeInfo | null>(() => (id === null ? null : (nodeCache.get(key(version, id)) ?? null)));
  useEffect(() => {
    if (id === null) {
      setNode(null);
      return;
    }
    const k = key(version, id);
    if (nodeCache.has(k)) {
      setNode(nodeCache.get(k) ?? null);
      return;
    }
    let alive = true;
    backend()
      .node(id)
      .then((n) => {
        nodeCache.set(k, n);
        if (alive) setNode(n);
      })
      .catch(() => alive && setNode(null));
    return () => {
      alive = false;
    };
  }, [id, version]);
  return node;
}

export async function fetchNode(id: number): Promise<NodeInfo | null> {
  const version = useDiskStore.getState().dataVersion;
  const k = key(version, id);
  if (nodeCache.has(k)) return nodeCache.get(k) ?? null;
  const n = await backend().node(id).catch(() => null);
  nodeCache.set(k, n);
  return n;
}

/** Root → current node chain, for the breadcrumb. */
export function useAncestors(id: number): NodeInfo[] {
  const version = useDiskStore((s) => s.dataVersion);
  const [chain, setChain] = useState<NodeInfo[]>([]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const out: NodeInfo[] = [];
      let cur: number | null = id;
      let guard = 0;
      while (cur !== null && guard++ < 64) {
        const n: NodeInfo | null = await fetchNode(cur);
        if (!n) break;
        out.unshift(n);
        cur = n.parent;
      }
      if (alive) setChain(out);
    })();
    return () => {
      alive = false;
    };
  }, [id, version]);
  return chain;
}

/** Rounds `minBytes` to a power of two so a 3 px resize does not refetch. */
function bucket(minBytes: number): number {
  if (minBytes <= 0) return 0;
  return 2 ** Math.floor(Math.log2(minBytes));
}

export interface SubtreeState {
  tree: TreeNode | null;
  loading: boolean;
}

/**
 * The pruned subtree for the visual views. `areaPx` is the canvas area; a
 * child under ~4 px² is folded into the "rest" block server-side.
 */
export function useSubtree(id: number, depth: number, rootSize: number, areaPx: number): SubtreeState {
  const version = useDiskStore((s) => s.dataVersion);
  const minBytes = areaPx > 0 && rootSize > 0 ? bucket((rootSize * 4) / areaPx) : 0;
  const k = key(version, id, depth, minBytes);
  const [state, setState] = useState<SubtreeState>(() => ({ tree: subtreeCache.get(k) ?? null, loading: !subtreeCache.has(k) }));
  const last = useRef(k);
  useEffect(() => {
    last.current = k;
    if (subtreeCache.has(k)) {
      setState({ tree: subtreeCache.get(k) ?? null, loading: false });
      return;
    }
    setState((s) => ({ tree: s.tree, loading: true }));
    let alive = true;
    backend()
      .subtree(id, { depth, minBytes, maxChildren: 400, budget: 40_000 })
      .then((tree) => {
        subtreeCache.set(k, tree);
        if (alive && last.current === k) setState({ tree, loading: false });
      })
      .catch(() => alive && setState({ tree: null, loading: false }));
    return () => {
      alive = false;
    };
  }, [k, id, depth, minBytes]);
  return state;
}

export function useChildren(id: number | null, limit = 3000): { items: NodeInfo[]; total: number; loading: boolean } {
  const version = useDiskStore((s) => s.dataVersion);
  const [state, setState] = useState<{ items: NodeInfo[]; total: number; loading: boolean }>({ items: [], total: 0, loading: id !== null });
  useEffect(() => {
    if (id === null) {
      setState({ items: [], total: 0, loading: false });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    backend()
      .children(id, limit)
      .then((page) => alive && setState({ items: page.items, total: page.total, loading: false }))
      .catch(() => alive && setState({ items: [], total: 0, loading: false }));
    return () => {
      alive = false;
    };
  }, [id, limit, version]);
  return state;
}

export function useTopFiles(id: number | null, query: TopFilesQuery): { items: NodeInfo[]; loading: boolean } {
  const version = useDiskStore((s) => s.dataVersion);
  const [state, setState] = useState<{ items: NodeInfo[]; loading: boolean }>({ items: [], loading: id !== null });
  const qk = JSON.stringify(query);
  useEffect(() => {
    if (id === null) {
      setState({ items: [], loading: false });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    backend()
      .topFiles(id, JSON.parse(qk) as TopFilesQuery)
      .then((items) => alive && setState({ items, loading: false }))
      .catch(() => alive && setState({ items: [], loading: false }));
    return () => {
      alive = false;
    };
  }, [id, qk, version]);
  return state;
}

export function useBreakdown(id: number | null): Breakdown | null {
  const version = useDiskStore((s) => s.dataVersion);
  const [b, setB] = useState<Breakdown | null>(null);
  useEffect(() => {
    if (id === null) {
      setB(null);
      return;
    }
    let alive = true;
    backend()
      .breakdown(id)
      .then((x) => alive && setB(x))
      .catch(() => alive && setB(null));
    return () => {
      alive = false;
    };
  }, [id, version]);
  return b;
}

export function useSearch(query: string): { items: NodeInfo[]; loading: boolean } {
  const version = useDiskStore((s) => s.dataVersion);
  const [state, setState] = useState<{ items: NodeInfo[]; loading: boolean }>({ items: [], loading: false });
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setState({ items: [], loading: false });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    const t = setTimeout(() => {
      backend()
        .search(q, 300)
        .then((items) => alive && setState({ items, loading: false }))
        .catch(() => alive && setState({ items: [], loading: false }));
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, version]);
  return state;
}

/** Measures an element; returns its content box size. */
export function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setSize((s) => (Math.abs(s.w - r.width) < 1 && Math.abs(s.h - r.height) < 1 ? s : { w: r.width, h: r.height }));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}
