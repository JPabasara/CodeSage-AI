"use client"

import { findingSummary } from "@/lib/finding-summary"
import { LearnMore } from "@/components/support/learn-more"

import {
  CheckCircle2,
  ExternalLink,
  Link2,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { DisableRuleButton } from "@/components/dashboard/disable-rule-button"
import { CodeExcerpt } from "@/components/dashboard/code-excerpt"
import { FindingMeta } from "@/components/dashboard/finding-tag"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { getPmdRuleGuidance } from "@/lib/pmd-rule-guidance"
import type { Finding, FindingStatus } from "@/lib/types"

export type FindingDetailPanelProps = {
  finding: Finding | null
  repositoryUrl?: string
  commitSha?: string
  hasFindings?: boolean
  onClose: () => void
  canDisableRules?: boolean
  canTriage?: boolean
  statusBusy?: boolean
  onStatusChange?: (finding: Finding, status: FindingStatus) => void
}

/** The file at the analysed commit, or null when the metadata can't be trusted. */
function githubLocation(
  repositoryUrl: string | undefined,
  commitSha: string | undefined,
  finding: Finding,
) {
  if (!repositoryUrl || !commitSha || !/^[a-f0-9]{40}$/i.test(commitSha)) {
    return null
  }
  const repository = repositoryUrl.match(
    /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)\/?$/,
  )
  const segments = finding.file.split("/")
  if (
    !repository ||
    !Number.isSafeInteger(finding.line) ||
    finding.line < 1 ||
    segments.some(
      (part) => !part || part === "." || part === ".." || part.includes("\\"),
    )
  ) {
    return null
  }
  const repoName = repository[2].replace(/\.git$/, "")
  if (!repoName || repoName === "." || repoName === "..") return null
  return {
    owner: repository[1],
    repo: repoName,
    commitSha,
    path: segments.map(encodeURIComponent).join("/"),
  }
}

function githubFindingUrl(
  location: NonNullable<ReturnType<typeof githubLocation>>,
  finding: Finding,
) {
  const end = finding.end_line
  const range =
    end != null && Number.isSafeInteger(end) && end > finding.line
      ? `-L${end}`
      : ""
  return `https://github.com/${location.owner}/${location.repo}/blob/${location.commitSha}/${location.path}#L${finding.line}${range}`
}

function githubRawUrl(
  location: NonNullable<ReturnType<typeof githubLocation>>,
) {
  return `https://raw.githubusercontent.com/${location.owner}/${location.repo}/${location.commitSha}/${location.path}`
}

function SectionTitle({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </h3>
  )
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(window.location.href)
    toast.success("Link to this finding copied.")
  } catch {
    toast.error("Could not copy the link. Copy it from the address bar.")
  }
}

export function FindingDetailPanel({
  finding,
  repositoryUrl,
  commitSha,
  hasFindings = false,
  onClose,
  canDisableRules = false,
  canTriage = false,
  statusBusy = false,
  onStatusChange,
}: Readonly<FindingDetailPanelProps>) {
  const closeButton = (
    <Button
      variant="ghost"
      size="icon-lg"
      className="-mt-1 -mr-1.5 shrink-0 text-muted-foreground"
      aria-label="Close finding detail"
      onClick={onClose}
    >
      <X />
    </Button>
  )

  if (!finding) {
    return (
      <section
        aria-label="Finding detail"
        className="flex items-start justify-between gap-2 rounded-md border bg-card px-5 py-4.5"
      >
        <div>
          <h2 className="text-base font-semibold text-foreground-strong">
            {hasFindings ? "Select a finding" : "No findings to show"}
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {hasFindings
              ? "Choose a finding from the list to open its details here."
              : "There are no findings in this snapshot. Try another scan or choose a different branch."}
          </p>
        </div>
        {closeButton}
      </section>
    )
  }

  const pmdGuidance = getPmdRuleGuidance(finding.rule_id)
  const location = githubLocation(repositoryUrl, commitSha, finding)
  const done = finding.status === "done"
  const hasEvidence =
    finding.metric_value !== undefined &&
    finding.metric_value !== null &&
    finding.threshold !== undefined &&
    finding.threshold !== null

  // Pinned beside a long list: never taller than the space under the top bar.
  return (
    <section
      aria-label="Finding detail"
      className="flex min-h-0 flex-col rounded-md border bg-card lg:max-h-[calc(100svh-6rem)]"
    >
      <header className="flex items-start justify-between gap-3 px-5 pt-4.5">
        <div className="min-w-0">
          <FindingMeta finding={finding} location={false}>
            <span className="tabular-nums">
              Priority {Math.round(finding.priority)}
            </span>
            {done ? <Badge variant="outline">Done</Badge> : null}
          </FindingMeta>
          <h2 className="mt-2 text-[1.0625rem] leading-snug font-semibold wrap-break-word text-foreground-strong">
            {findingSummary(finding)}
          </h2>
        </div>
        {closeButton}
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pt-3 pb-5 text-sm">
        <p className="font-mono text-[0.8125rem] break-all text-muted-foreground tabular-nums">
          <span>
            {finding.file}:{finding.line}
          </span>
          {finding.symbol ? (
            <span className="font-sans"> · {finding.symbol}</span>
          ) : null}
        </p>

        {location ? (
          <div className="space-y-2.5">
            <CodeExcerpt
              rawUrl={githubRawUrl(location)}
              line={finding.line}
              endLine={finding.end_line}
            />
            <a
              className="inline-flex items-center gap-1.5 rounded-sm text-[0.84375rem] font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              href={githubFindingUrl(location, finding)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open at line {finding.line} on GitHub
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          </div>
        ) : null}

        {pmdGuidance ? (
          <>
            <section>
              <SectionTitle>What PMD found</SectionTitle>
              <p>
                Rule{" "}
                <span className="font-mono text-[0.8125rem]">
                  {finding.rule_id?.slice(4)}
                </span>
                {hasEvidence ? (
                  <>
                    {" "}
                    · measured{" "}
                    <span className="font-semibold tabular-nums">
                      {finding.metric_value}
                    </span>
                    , limit{" "}
                    <span className="font-semibold tabular-nums">
                      {finding.threshold}
                    </span>
                  </>
                ) : null}
              </p>
            </section>
            <section>
              <SectionTitle>Why it matters</SectionTitle>
              <p>{pmdGuidance.impact}</p>
            </section>
            <section>
              <SectionTitle>How to fix it</SectionTitle>
              <p>{pmdGuidance.recommendation}</p>
              <a
                className="mt-2 inline-block text-xs font-medium text-primary underline-offset-4 hover:underline"
                href={pmdGuidance.documentationUrl}
                target="_blank"
                rel="noreferrer"
              >
                Read the PMD rule documentation
              </a>
            </section>
          </>
        ) : (
          <>
            {finding.comment_text ? (
              <section>
                <SectionTitle>
                  {finding.rule_id === "comment-pattern"
                    ? "Matched comment"
                    : "What the comment says"}
                </SectionTitle>
                <blockquote className="border-l-2 pl-3 text-foreground italic">
                  {finding.comment_text}
                </blockquote>
              </section>
            ) : null}
            {hasEvidence ? (
              <section>
                <SectionTitle>Evidence</SectionTitle>
                <p>
                  Measured{" "}
                  <span className="font-semibold tabular-nums">
                    {finding.metric_value}
                  </span>
                  , limit{" "}
                  <span className="font-semibold tabular-nums">
                    {finding.threshold}
                  </span>
                  {finding.rule_id ? (
                    <span className="text-muted-foreground">
                      {" "}
                      · rule {finding.rule_id}
                    </span>
                  ) : null}
                </p>
              </section>
            ) : null}
          </>
        )}

        <LearnMore
          article={
            finding.source === "satd" ? "satd-detection" : "debt-detection"
          }
          about="how this finding was detected"
        />

        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          {canDisableRules &&
          finding.source === "rule" &&
          finding.rule_id &&
          (finding.rule_id.startsWith("pmd:") ||
            [
              "large-file",
              "complex-function",
              "long-method",
              "deep-nesting",
              "hardcoded-secret",
              "sql-concat",
            ].includes(finding.rule_id)) ? (
            <DisableRuleButton key={finding.rule_id} ruleId={finding.rule_id} />
          ) : null}
          {canTriage ? (
            <Button
              type="button"
              variant="outline"
              className="h-9 px-3.5 text-sm"
              disabled={statusBusy}
              onClick={() => onStatusChange?.(finding, done ? "open" : "done")}
            >
              {statusBusy ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : done ? (
                <RotateCcw aria-hidden="true" />
              ) : (
                <CheckCircle2 aria-hidden="true" />
              )}
              {done ? "Reopen" : "Mark as done"}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            className="h-9 px-3 text-sm"
            onClick={() => void copyLink()}
          >
            <Link2 aria-hidden="true" />
            Copy link
          </Button>
        </div>
      </div>
    </section>
  )
}
