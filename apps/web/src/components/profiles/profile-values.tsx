"use client"

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
}

/**
 * The five categories, in the order they are shown. Keyed off CategoryWeights so
 * adding a sixth category to the contract breaks this list at compile time rather
 * than silently rendering four sliders.
 */
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
    WEIGHT_ROWS.every(({ key }) => near(a.weights[key], b.weights[key]))
  )
}

/** The six numbers of a stored profile, without the pool facts around them. */
export const valuesOf = (profile: ScoreProfile): ProfileValues => ({
  weights: profile.weights,
  trust_s: profile.trust_s,
})

/**
 * The five weight sliders and the trust slider.
 *
 * Shared by the editor on the page and by the create dialog, so a weight cannot
 * come to mean one thing in one of them and something else in the other. Both
 * render at once, which is why every id and test id is namespaced by `idPrefix`
 * — two rows called `value-security` in one document is the bug this prevents.
 *
 * `disabled` is how a built-in is shown: its numbers are worth reading and can
 * never be written, so the rows render and do not operate.
 *
 * `compact` is the page's layout: the six sliders in a grid, label and value on
 * one line, and the longer hints moved to the label's tooltip so the whole
 * editor fits beside the pool without scrolling. The dialog keeps the stacked
 * layout, where there is room to say what each category covers.
 */
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

  if (compact) {
    // One grid of six. The headings stay for screen readers; on screen the
    // labels already say which is which.
    return (
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
        <h3 className="sr-only">Category weights</h3>
        {weightSliders}
        {trustSlider}
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
    </div>
  )
}
