"use client"

import { Slider } from "@/components/ui/slider"
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
 */
export function ProfileValueEditor({
  values,
  onChange,
  disabled = false,
  idPrefix = "",
}: Readonly<{
  values: ProfileValues
  onChange?: (next: ProfileValues) => void
  disabled?: boolean
  idPrefix?: string
}>) {
  const set = (next: ProfileValues) => onChange?.(next)

  return (
    <div className="space-y-6">
      <section className="space-y-5">
        <h3 className="text-sm font-medium">Category weights</h3>
        {WEIGHT_ROWS.map(({ key, label, hint }) => (
          <div key={key} className="space-y-2">
            <div className="flex items-baseline justify-between gap-4">
              <label htmlFor={`${idPrefix}weight-${key}`} className="text-sm">
                {label}
                <span className="ml-2 text-xs text-muted-foreground">
                  {hint}
                </span>
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
        ))}
      </section>

      <section className="space-y-2">
        <div className="flex items-baseline justify-between gap-4">
          <label htmlFor={`${idPrefix}trust-s`} className="text-sm">
            Trust
            <span className="ml-2 text-xs text-muted-foreground">
              0 = trust the model · 1 = trust the rules
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
        <p className="text-xs text-muted-foreground">
          Security findings are excluded — no position of this slider can
          de-weight them.
        </p>
      </section>
    </div>
  )
}
