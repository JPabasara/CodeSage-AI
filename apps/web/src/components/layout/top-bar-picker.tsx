"use client"

import { useRef, useState } from "react"
import { Check, ChevronDown, Loader2 } from "lucide-react"

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type PickerItem = {
  value: string
  label: string
  caption?: string
  /** Shown at the row's end, before the check: a grade, a "Default" tag. */
  trailing?: React.ReactNode
  /** Render the label in the mono face (branch names). */
  mono?: boolean
}

const SEARCH_THRESHOLD = 6

/** One step of the context path on the brand bar: a caption over a value, no box. */
export const topBarControl =
  "inline-flex h-11 min-w-0 flex-col items-start justify-center gap-1 rounded-md px-2.5 text-left text-tb-fg outline-none transition-colors hover:bg-tb-hover focus-visible:ring-2 focus-visible:ring-tb-focus disabled:opacity-60 aria-expanded:bg-tb-hover"

/** The small caption above a value in the context path. */
export const topBarCaption =
  "hidden text-[0.65625rem] leading-none font-medium tracking-[0.08em] text-tb-label uppercase md:block"

export function TopBarPicker({
  label,
  ariaLabel,
  icon,
  items,
  activeValue,
  activeLabel,
  activeCaption,
  mono = false,
  heading,
  onSelect,
  onItemIntent,
  onItemLeave,
  busy = false,
  emptyMessage,
  footer,
  className,
  tourTarget,
}: Readonly<{
  /** What is being picked: "Workspace", "Project", "Branch". Shown as the caption. */
  label: string
  /** The control's name; defaults to "‹label›: ‹activeLabel›". */
  ariaLabel?: string
  /** A small glyph before the value (the branch icon), or nothing. */
  icon?: React.ReactNode
  items: PickerItem[]
  activeValue?: string
  activeLabel: string
  /** Quiet text after the value, such as the role. */
  activeCaption?: string
  /** Show the value in the mono face (branch names). */
  mono?: boolean
  /** The popover's heading, e.g. "Projects in Acme". */
  heading?: string
  onSelect: (value: string) => void
  /** The pointer rests on an item: a chance to warm what it opens. */
  onItemIntent?: (value: string) => void
  onItemLeave?: () => void
  busy?: boolean
  emptyMessage: string
  footer?: (close: () => void) => React.ReactNode
  className?: string
  /** Stable anchor used by the optional guided product tour. */
  tourTarget?: string
}>) {
  const [open, setOpen] = useState(false)
  const commandRef = useRef<HTMLDivElement>(null)
  const searchable = items.length > SEARCH_THRESHOLD
  const close = () => setOpen(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-tour={tourTarget}
        role="combobox"
        aria-label={ariaLabel ?? `${label}: ${activeLabel}`}
        aria-haspopup="listbox"
        disabled={busy}
        className={cn(topBarControl, className)}
      >
        <span className={topBarCaption} aria-hidden="true">
          {label}
        </span>
        <span className="flex max-w-full min-w-0 items-center gap-1.5 text-[0.90625rem] leading-tight font-semibold">
          {busy ? (
            <Loader2
              className="size-3.5 shrink-0 animate-spin text-tb-muted"
              aria-hidden="true"
            />
          ) : icon ? (
            <span
              className="shrink-0 text-tb-muted [&_svg]:size-3.5"
              aria-hidden="true"
            >
              {icon}
            </span>
          ) : null}
          <span
            className={cn("truncate", mono && "font-mono text-sm font-medium")}
            title={activeLabel}
          >
            {activeLabel}
          </span>
          {activeCaption || busy ? (
            <span className="hidden shrink-0 text-xs font-normal text-tb-muted lg:inline">
              {busy ? "Switching…" : activeCaption}
            </span>
          ) : null}
          <ChevronDown
            className="size-3.5 shrink-0 text-tb-muted"
            aria-hidden="true"
          />
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 p-0"
        // Focus the list itself (or its search), so arrow keys work at once.
        onOpenAutoFocus={(event) => {
          if (searchable) return
          event.preventDefault()
          commandRef.current?.focus()
        }}
      >
        <Command ref={commandRef} tabIndex={-1} className="outline-none">
          <p className="px-3 pt-2.5 pb-1.5 text-[0.6875rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            {heading ?? label}
          </p>
          {searchable ? (
            <CommandInput placeholder={`Find a ${label.toLowerCase()}…`} />
          ) : null}
          <CommandList aria-label={label}>
            {items.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">
                {emptyMessage}
              </p>
            ) : (
              <CommandEmpty>No match.</CommandEmpty>
            )}
            {items.length > 0 ? (
              <CommandGroup>
                {items.map((item) => (
                  <CommandItem
                    key={item.value}
                    value={item.value}
                    keywords={[item.label, item.caption ?? ""]}
                    onSelect={() => {
                      close()
                      onSelect(item.value)
                    }}
                    onPointerEnter={() => onItemIntent?.(item.value)}
                    onPointerLeave={onItemLeave}
                    className="gap-2.5 py-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate font-medium text-foreground-strong",
                          item.mono && "font-mono text-[0.84375rem]",
                        )}
                      >
                        {item.label}
                      </span>
                      {item.caption ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.caption}
                        </span>
                      ) : null}
                    </span>
                    {item.trailing}
                    <Check
                      className={cn(
                        "size-4 shrink-0 text-primary",
                        item.value === activeValue
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                      aria-hidden="true"
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {footer ? (
              <>
                <CommandSeparator />
                <CommandGroup>{footer(close)}</CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** A row in the picker's footer, kept visible while the list is searched. */
export function TopBarPickerAction({
  icon,
  children,
  onSelect,
}: Readonly<{
  icon: React.ReactNode
  children: React.ReactNode
  onSelect: () => void
}>) {
  return (
    <CommandItem
      forceMount
      value={`action:${String(children)}`}
      onSelect={onSelect}
    >
      <span className="text-muted-foreground" aria-hidden="true">
        {icon}
      </span>
      {children}
    </CommandItem>
  )
}

/** The thin slash between steps of the context path. */
export function TopBarSeparator({
  className,
}: Readonly<{ className?: string }>) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "px-0.5 text-xl leading-none font-light text-tb-label/70 select-none",
        className,
      )}
    >
      /
    </span>
  )
}
