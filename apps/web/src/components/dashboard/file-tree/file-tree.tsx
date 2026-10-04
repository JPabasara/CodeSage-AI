"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronDown, ChevronRight, FileCode2, Folder } from "lucide-react"

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

function nodeScoreLabel(node: TreeNode, withFindings: boolean) {
  const label = `${node.name}, grade ${node.grade}, score ${Math.round(
    node.health_score,
  )}`
  return withFindings ? `${label}, has findings` : label
}

/** Java files under a folder, all the way down. */
function fileCount(node: TreeNode): number {
  if (node.type === "file") return 1
  return (node.children ?? []).reduce((sum, child) => sum + fileCount(child), 0)
}

/** The score as text: red when hot, green when healthy, plain in between. */
function scoreTone(score: number) {
  if (score < 40) return "text-trend-down"
  if (score >= 70) return "text-trend-up"
  return "text-foreground-strong"
}

// The heat-map legend: the same three bands as healthColor().
const LEGEND = [
  { label: "Hot", color: "hsl(var(--health-bad))" },
  { label: "Watch", color: "hsl(var(--health-mid))" },
  { label: "Healthy", color: "hsl(var(--health-good))" },
]

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
      const withFindings = !isFolder && Boolean(hasFinding?.(node))

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
            aria-label={nodeScoreLabel(node, withFindings)}
            className={cn(
              "group/file flex h-[2.125rem] w-full items-center gap-2 rounded-md pr-2.5 text-left text-sm hover:bg-muted",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              isSelected && "bg-accent text-accent-foreground hover:bg-accent",
            )}
            style={{ paddingLeft: depth * 18 + 6 }}
            onMouseEnter={() => onHoverNode?.(node)}
            onMouseLeave={() => onHoverNode?.(null)}
            onClick={() => selectNode(node)}
          >
            <span
              aria-hidden="true"
              data-slot="health-bar"
              className="my-1.5 w-1 shrink-0 self-stretch rounded-xs"
              style={{ backgroundColor: colorFor(node) }}
            />
            {chevron}
            {isFolder ? (
              <Folder
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            ) : (
              <FileCode2
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            )}
            <span
              className={cn(
                "min-w-0 truncate",
                isFolder && "font-semibold text-foreground-strong",
                isSelected && "font-medium",
              )}
            >
              {node.name}
            </span>
            {isFolder ? (
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {fileCount(node)} {fileCount(node) === 1 ? "file" : "files"}
              </span>
            ) : null}
            <span className="flex-1" />
            {withFindings ? (
              // A neutral mark, not a health colour: this file has findings to open.
              <span
                aria-hidden="true"
                title="Has findings"
                className="size-1.5 shrink-0 rounded-full bg-foreground/55"
              />
            ) : null}
            <span
              className="inline-flex min-w-11 shrink-0 items-baseline justify-end gap-1.5 tabular-nums"
              aria-hidden="true"
            >
              <span className="text-xs text-muted-foreground">
                {node.grade}
              </span>
              <span
                className={cn(
                  "text-[0.8125rem] font-semibold",
                  scoreTone(node.health_score),
                )}
              >
                {Math.round(node.health_score)}
              </span>
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
      <section
        aria-label="File health tree"
        className="flex h-full min-h-0 flex-col items-center justify-center space-y-2 rounded-md border bg-card p-8 text-center"
      >
        <div className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Folder className="size-5" aria-hidden="true" />
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
      </section>
    )
  }

  return (
    <section
      aria-label="File health tree"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border bg-card"
    >
      <div className="shrink-0 space-y-2.5 border-b px-4 pt-3.5 pb-3">
        <div>
          <h2 className="text-base font-semibold text-foreground-strong">
            Code map
          </h2>
          <p className="text-xs text-muted-foreground">
            Java files only, coloured by file health. Folders show the score of
            everything inside them.
          </p>
        </div>

        {/* The keys mirror the mark on each row: a short bar, not a dot. */}
        <div
          role="group"
          aria-label="Heat map legend"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
        >
          {LEGEND.map((item) => (
            <span key={item.label} className="inline-flex items-center gap-1.5">
              <span
                className="h-3 w-1 rounded-sm"
                style={{ backgroundColor: item.color }}
                aria-hidden="true"
              />
              {item.label}
            </span>
          ))}
          {hasFinding ? (
            <span className="inline-flex items-center gap-1.5">
              <span
                className="size-1.5 rounded-full bg-foreground/55"
                aria-hidden="true"
              />
              Has findings
            </span>
          ) : null}
        </div>

        {selectionNotice ? (
          <p
            role="status"
            aria-live="polite"
            className="rounded-md border bg-muted/50 px-2 py-1 text-xs text-muted-foreground"
          >
            {selectionNotice}
          </p>
        ) : null}
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto p-1.5"
        data-testid="file-tree-scroll"
      >
        <ul className="text-sm">{renderNodes(nodes, 0)}</ul>
      </div>
    </section>
  )
}
