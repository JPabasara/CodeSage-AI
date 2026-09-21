"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronDown, ChevronRight, File, Folder } from "lucide-react"

import type { TreeNode } from "@/lib/types"
import { cn } from "@/lib/utils"

export interface FileTreeProps {
  nodes: TreeNode[]
  colorFor: (node: TreeNode) => string
  hasFinding?: (node: TreeNode) => boolean
  onHoverNode?: (node: TreeNode | null) => void
  onSelectNode?: (node: TreeNode) => void
  onSelectNodeWithoutFinding?: (node: TreeNode) => void
  selectionNotice?: string | null
  selectedPath?: string
}

function ancestorPaths(path: string) {
  const parts = path.split("/")
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"))
}

function collectFolderPaths(nodes: TreeNode[], acc: Set<string>) {
  for (const node of nodes) {
    if (node.type === "folder") {
      acc.add(node.path)
      if (node.children) collectFolderPaths(node.children, acc)
    }
  }
  return acc
}

function nodeScoreLabel(node: TreeNode) {
  return `${node.name}, grade ${node.grade}, score ${Math.round(
    node.health_score,
  )}`
}

export function FileTree({
  nodes,
  colorFor,
  hasFinding,
  onHoverNode,
  onSelectNode,
  onSelectNodeWithoutFinding,
  selectionNotice,
  selectedPath,
}: Readonly<FileTreeProps>) {
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    collectFolderPaths(nodes, new Set()),
  )

  const [revealed, setRevealed] = useState<string>()
  if (selectedPath && selectedPath !== revealed) {
    setRevealed(selectedPath)
    const missing = ancestorPaths(selectedPath).filter((p) => !expanded.has(p))
    if (missing.length > 0) setExpanded(new Set([...expanded, ...missing]))
  }

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

  const selectNode = (node: TreeNode) => {
    if (node.type === "folder") {
      toggle(node.path)
      onSelectNode?.(node)
      return
    }

    if (hasFinding && !hasFinding(node)) {
      onSelectNodeWithoutFinding?.(node)
      return
    }

    onSelectNode?.(node)
  }

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
            aria-label={nodeScoreLabel(node)}
            className={cn(
              "group/file flex h-8 w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-sm hover:bg-accent/70",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              isSelected && "bg-accent font-medium ring-1 ring-primary",
            )}
            style={{
              paddingLeft: depth * 14 + 6,
              borderLeft: `3px solid ${colorFor(node)}`,
            }}
            onMouseEnter={() => onHoverNode?.(node)}
            onMouseLeave={() => onHoverNode?.(null)}
            onClick={() => selectNode(node)}
          >
            {chevron}
            {isFolder ? (
              <Folder className="size-4 shrink-0" />
            ) : (
              <File className="size-4 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate">{node.name}</span>
            <span
              className="ml-2 inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-border/70 bg-background px-1.5 text-[0.625rem] font-medium tabular-nums text-muted-foreground"
              aria-hidden="true"
            >
              <span className="font-semibold text-foreground">
                {node.grade}
              </span>
              {Math.round(node.health_score)}
            </span>
          </button>

          {isFolder && isOpen && node.children ? (
            <ul>{renderNodes(node.children, depth + 1)}</ul>
          ) : null}
        </li>
      )
    })

  if (nodes.length === 0) {
    return (
      <div
        aria-label="File health tree"
        className="flex h-full min-h-0 flex-col items-center justify-center rounded-lg border-t-2 border-t-primary/60 bg-card p-8 text-center shadow-sm ring-1 ring-foreground/10 space-y-2"
      >
        <div className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Folder className="size-5" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">No files in this tree</p>
          <p className="text-xs text-muted-foreground">
            No files were detected in this snapshot.
          </p>
          <p className="text-xs text-muted-foreground">
            Run a scan to analyze and display the repository file hierarchy.
          </p>
        </div>
      </div>
    )
  }

  return (
    <section
      aria-label="File health tree"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border-t-2 border-t-primary/60 bg-card shadow-sm ring-1 ring-foreground/10"
    >
      <div className="shrink-0 border-b px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">File health map</h2>
            <p className="text-xs text-muted-foreground">
              Scores are shown per file and folded up through folders.
            </p>
          </div>
        </div>

        <div
          className="mt-3 flex flex-wrap items-center gap-2 text-[0.625rem] font-medium text-muted-foreground"
          aria-label="Heat map legend"
        >
          <span>Heat map legend</span>
          <span className="inline-flex items-center gap-1">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: "hsl(var(--health-bad))" }}
              aria-hidden="true"
            />
            Hot
          </span>
          <span className="inline-flex items-center gap-1">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: "hsl(var(--health-mid))" }}
              aria-hidden="true"
            />
            Watch
          </span>
          <span className="inline-flex items-center gap-1">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: "hsl(var(--health-good))" }}
              aria-hidden="true"
            />
            Healthy
          </span>
        </div>

        {selectionNotice ? (
          <p
            role="status"
            aria-live="polite"
            className="mt-2 rounded-md border border-border/70 bg-background px-2 py-1 text-xs text-muted-foreground"
          >
            {selectionNotice}
          </p>
        ) : null}
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto p-2"
        data-testid="file-tree-scroll"
      >
        <ul className="space-y-0.5 text-sm">{renderNodes(nodes, 0)}</ul>
      </div>
    </section>
  )
}
