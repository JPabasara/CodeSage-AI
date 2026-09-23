"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Slider({
  className,
  "aria-label": ariaLabel,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  // A disabled Radix thumb is a <span role="slider">, not a form control, so
  // `disabled` alone is invisible to assistive technology: it stops responding
  // and announces nothing about why. aria-disabled is what says so out loud.
  const ariaDisabled = props.disabled ? true : undefined
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        "relative flex w-full touch-none select-none items-center",
        "data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="bg-muted relative h-1.5 w-full grow overflow-hidden rounded-full"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="bg-primary absolute h-full"
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        aria-label={ariaLabel}
        aria-disabled={ariaDisabled}
        className={cn(
          "border-primary bg-background block size-4 rounded-full border-2 shadow-sm transition-colors",
          "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
          "disabled:pointer-events-none",
        )}
      />
    </SliderPrimitive.Root>
  )
}

export { Slider }
