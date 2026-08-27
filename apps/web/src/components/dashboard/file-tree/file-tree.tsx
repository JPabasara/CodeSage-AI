"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronDown, ChevronRight, File, Folder } from "lucide-react"

import type { TreeNode } from "@/lib/types"
import { cn } from "@/lib/utils"

// PUBLIC boundary (stable). v1 renders a simple recursive tree; a virtualized
// library can be swapped in later without touching anything outside this file.
export interface FileTreeProps {
  nodes: TreeNode[]
  colorFor: (node: TreeNode) => string // heat-map tint from health_score
  onHoverNode?: (node: TreeNode | null) => void // drives Card B later
  onSelectNode?: (node: TreeNode) => void // opens finding detail / focuses file
  /** The file the dashboard is showing detail for. Its folders open automatically. */
  selectedPath?: string
}

/** "src/payments/x.ts" → ["src", "src/payments"] — the folders that hide it. */
function ancestorPaths(path: string) {
  const parts = path.split("/")
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"))
}

function collectFolderPaths(nodes: TreeNode[], acc: Set<string>) {
  for (const n of nodes) {
    if (n.type === "folder") {
      acc.add(n.path)
      if (n.children) collectFolderPaths(n.children, acc)
    }
  }
  return acc
}

export function FileTree({
  nodes,
  colorFor,
  onHoverNode,
  onSelectNode,
  selectedPath,
}: Readonly<FileTreeProps>) {
  // default: all folders expanded, so the heat map reads at a glance
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    collectFolderPaths(nodes, new Set()),
  )

  // D-CR7: entering detail mode must REVEAL the finding's file, not just tint a
  // row the user cannot see. Folders start expanded, but a user may have
  // collapsed this one — so re-open its ancestors whenever the selection MOVES.
  //
  // Adjusted during render, not in an effect (React's documented pattern for
  // "state that depends on a prop change"): an effect would render the tree
  // once with the file still hidden, then again with it shown. Keyed on
  // `revealed` so this fires once per selection — collapsing the folder again
  // afterwards still works, it just does not fight the user.
  const [revealed, setRevealed] = useState<string>()
  if (selectedPath && selectedPath !== revealed) {
    setRevealed(selectedPath)
    const missing = ancestorPaths(selectedPath).filter((p) => !expanded.has(p))
    if (missing.length > 0) setExpanded(new Set([...expanded, ...missing]))
  }

  // Runs after the expansion above has re-rendered, so the row exists by now.
  // "nearest" scrolls the tree's own scroll container, never the whole page.
  const selectedRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (selectedPath) selectedRef.current?.scrollIntoView({ block: "nearest" })
  }, [selectedPath, expanded])

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const renderNodes = (list: TreeNode[], depth: number) =>
    list.map((node) => {
      const isFolder = node.type === "folder"
      const isOpen = expanded.has(node.path)
      const isSelected = node.path === selectedPath

      let chevron
      if (!isFolder) chevron = <span className="inline-block w-3.5 shrink-0" />
      else if (isOpen) chevron = <ChevronDown className="size-3.5 shrink-0" />
      else chevron = <ChevronRight className="size-3.5 shrink-0" />

      return (
        <li key={node.path}>
          <button
            type="button"
            ref={isSelected ? selectedRef : undefined}
            aria-current={isSelected ? "true" : undefined}
            className={cn(
              "hover:bg-accent flex w-full items-center gap-1.5 rounded py-1 pr-2 text-left text-sm",
              isSelected && "bg-accent ring-primary font-medium ring-1",
            )}
            style={{
              paddingLeft: depth * 14 + 6,
              borderLeft: `3px solid ${colorFor(node)}`,
            }}
            onMouseEnter={() => onHoverNode?.(node)}
            onMouseLeave={() => onHoverNode?.(null)}
            onClick={() => {
              if (isFolder) toggle(node.path)
              onSelectNode?.(node)
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
      )
    })

  return (
    <ul aria-label="File health tree" className="text-sm">
      {renderNodes(nodes, 0)}
    </ul>
  )
}
