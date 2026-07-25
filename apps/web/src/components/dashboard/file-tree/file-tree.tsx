"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, File, Folder } from "lucide-react";

import type { TreeNode } from "@/lib/types";
import { cn } from "@/lib/utils";

// PUBLIC boundary (stable). v1 renders a simple recursive tree; a virtualized
// library can be swapped in later without touching anything outside this file.
export interface FileTreeProps {
  nodes: TreeNode[];
  colorFor: (node: TreeNode) => string; // heat-map tint from healthScore
  onHoverNode?: (node: TreeNode | null) => void; // drives Card B later
  onSelectNode?: (node: TreeNode) => void; // opens finding detail / focuses file
  selectedPath?: string;
}

function collectFolderPaths(nodes: TreeNode[], acc: Set<string>) {
  for (const n of nodes) {
    if (n.type === "folder") {
      acc.add(n.path);
      if (n.children) collectFolderPaths(n.children, acc);
    }
  }
  return acc;
}

export function FileTree({
  nodes,
  colorFor,
  onHoverNode,
  onSelectNode,
  selectedPath,
}: Readonly<FileTreeProps>) {
  // default: all folders expanded, so the heat map reads at a glance
  const [expanded, setExpanded] = useState<Set<string>>(() => collectFolderPaths(nodes, new Set()));

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const renderNodes = (list: TreeNode[], depth: number) =>
    list.map((node) => {
      const isFolder = node.type === "folder";
      const isOpen = expanded.has(node.path);

      let chevron;
      if (!isFolder) chevron = <span className="inline-block w-3.5 shrink-0" />;
      else if (isOpen) chevron = <ChevronDown className="size-3.5 shrink-0" />;
      else chevron = <ChevronRight className="size-3.5 shrink-0" />;

      return (
        <li key={node.path}>
          <button
            type="button"
            className={cn(
              "hover:bg-accent flex w-full items-center gap-1.5 rounded py-1 pr-2 text-left text-sm",
              node.path === selectedPath && "bg-accent",
            )}
            style={{ paddingLeft: depth * 14 + 6, borderLeft: `3px solid ${colorFor(node)}` }}
            onMouseEnter={() => onHoverNode?.(node)}
            onMouseLeave={() => onHoverNode?.(null)}
            onClick={() => {
              if (isFolder) toggle(node.path);
              onSelectNode?.(node);
            }}
          >
            {chevron}
            {isFolder ? (
              <Folder className="size-4 shrink-0" />
            ) : (
              <File className="size-4 shrink-0" />
            )}
            <span className="truncate">{node.name}</span>
          </button>

          {isFolder && isOpen && node.children ? (
            <ul>{renderNodes(node.children, depth + 1)}</ul>
          ) : null}
        </li>
      );
    });

  return (
    <ul aria-label="File health tree" className="text-sm">
      {renderNodes(nodes, 0)}
    </ul>
  );
}
