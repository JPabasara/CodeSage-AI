"use client"

import { LearnMore } from "@/components/support/learn-more"

import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import {
  TRUST_MAX,
  TRUST_MIN,
  WEIGHT_MAX,
  WEIGHT_MIN,
  type CategoryWeights,
  type ScoreProfile,
} from "@/lib/types"

/** The six numbers a profile is, apart from its name and its place in the pool. */
export interface ProfileValues {
  weights: CategoryWeights
  trust_s: number
  include_test_findings?: boolean
}

export const WEIGHT_ROWS: {
  key: keyof CategoryWeights
  label: string
  hint: string
}[] = [
  {
    key: "security",
    label: "Security",
    hint: "Secrets, SQL concatenation, eval",
  },
  {
    key: "code_design",
    label: "Code design",
    hint: "Complexity, long files, duplication",
  },
  {
    key: "requirement",
    label: "Requirement",
    hint: "Self-admitted missing behaviour",
  },
  {
    key: "documentation",
    label: "Documentation",
    hint: "Missing or stale docs",
  },
  { key: "test", label: "Test", hint: "Missing or disabled tests" },
]

const TRUST_HINT = "0 = trust the model · 1 = trust the rules"
const TRUST_NOTE =
  "Security findings are excluded — no position of this slider can de-weight them."

/** Same six numbers? Compared with a tolerance because slider steps are floats. */
export function sameValues(a: ProfileValues, b: ProfileValues) {
  const near = (x: number, y: number) => Math.abs(x - y) < 1e-9
  return (
    near(a.trust_s, b.trust_s) &&
    Boolean(a.include_test_findings) === Boolean(b.include_test_findings) &&
    WEIGHT_ROWS.every(({ key }) => near(a.weights[key], b.weights[key]))
  )
}

/** The six numbers of a stored profile, without the pool facts around them. */
export const valuesOf = (profile: ScoreProfile): ProfileValues => ({
  weights: profile.weights,
  trust_s: profile.trust_s,
  include_test_findings: profile.include_test_findings ?? false,
})

export function ProfileValueEditor({
  values,
  onChange,
  disabled = false,
  idPrefix = "",
  compact = false,
}: Readonly<{
  values: ProfileValues
  onChange?: (next: ProfileValues) => void
  disabled?: boolean
  idPrefix?: string
  compact?: boolean
}>) {
  const set = (next: ProfileValues) => onChange?.(next)

  const weightSliders = WEIGHT_ROWS.map(({ key, label, hint }) => (
    <div
      key={key}
      className={cn("min-w-0", compact ? "space-y-2.5" : "space-y-2")}
    >
      <div className="flex items-baseline justify-between gap-3">
        <label
          htmlFor={`${idPrefix}weight-${key}`}
          className="min-w-0 truncate text-sm"
          title={compact ? hint : undefined}
        >
          {label}
          {compact ? null : (
            <span className="ml-2 text-xs text-muted-foreground">{hint}</span>
          )}
        </label>
        <span
          className="text-sm tabular-nums"
          data-testid={`${idPrefix}value-${key}`}
        >
          {values.weights[key].toFixed(1)}
        </span>
      </div>
      <Slider
        id={`${idPrefix}weight-${key}`}
        aria-label={`${label} weight`}
        disabled={disabled}
        min={WEIGHT_MIN}
        max={WEIGHT_MAX}
        step={0.1}
        value={[values.weights[key]]}
        onValueChange={([v]) =>
          set({ ...values, weights: { ...values.weights, [key]: v } })
        }
      />
    </div>
  ))

  const trustSlider = (
    <div className={cn("min-w-0", compact ? "space-y-2.5" : "space-y-2")}>
      <div className="flex items-baseline justify-between gap-3">
        <label
          htmlFor={`${idPrefix}trust-s`}
          className="min-w-0 truncate text-sm"
          title={compact ? `${TRUST_HINT}. ${TRUST_NOTE}` : undefined}
        >
          Trust
          <span className="ml-2 text-xs text-muted-foreground">
            {compact ? "0 model · 1 rules" : TRUST_HINT}
          </span>
        </label>
        <span
          className="text-sm tabular-nums"
          data-testid={`${idPrefix}value-trust_s`}
        >
          {values.trust_s.toFixed(2)}
        </span>
      </div>
      <Slider
        id={`${idPrefix}trust-s`}
        aria-label="Trust slider"
        disabled={disabled}
        min={TRUST_MIN}
        max={TRUST_MAX}
        step={0.05}
        value={[values.trust_s]}
        onValueChange={([v]) => set({ ...values, trust_s: v })}
      />
      {compact ? null : (
        <p className="text-xs text-muted-foreground">{TRUST_NOTE}</p>
      )}
    </div>
  )

  const configuration = (
    <section className="space-y-3 border-t pt-5">
      <h3 className="text-sm font-semibold">Configurations</h3>
      <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/20 p-3">
        <div className="space-y-1">
          <label
            htmlFor={`${idPrefix}include-test-findings`}
            className="text-sm font-medium"
          >
            Include test-code findings
          </label>
          <LearnMore
            article="profile-test-inclusion"
            about="test findings in scoring"
          />
          <p className="text-xs text-muted-foreground">
            Show findings from identified test paths in Refactor first by
            default.
          </p>
        </div>
        <button
          id={`${idPrefix}include-test-findings`}
          type="button"
          role="switch"
          aria-checked={Boolean(values.include_test_findings)}
          disabled={disabled}
          onClick={() =>
            set({
              ...values,
              include_test_findings: !values.include_test_findings,
            })
          }
          className={cn(
            "relative h-6 w-11 rounded-full border transition-colors disabled:opacity-50",
            values.include_test_findings ? "bg-primary" : "bg-muted",
          )}
        >
          <span
            className={cn(
              "absolute left-0.5 top-0.5 size-4 rounded-full bg-background shadow-sm transition-transform",
              values.include_test_findings ? "translate-x-5" : "translate-x-0",
            )}
          />
        </button>
      </div>
    </section>
  )

  if (compact) {
    return (
      <div className="space-y-6">
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
          <h3 className="sr-only">Category weights</h3>
          {weightSliders}
          {trustSlider}
        </div>
        {configuration}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="space-y-5">
        <h3 className="text-sm font-semibold">Category weights</h3>
        {weightSliders}
      </section>
      <section>{trustSlider}</section>
      {configuration}
    </div>
  )
}
