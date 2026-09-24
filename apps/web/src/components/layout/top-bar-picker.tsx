"use client"

import { useRef, useState } from "react"
import { Check, ChevronsUpDown, Loader2 } from "lucide-react"

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

export type PickerItem = { value: string; label: string; caption?: string }

/** Above this many choices the menu grows a search field. */
const SEARCH_THRESHOLD = 6

/** A quiet control on the deep-mint bar: white text, a faint white fill. */
export const topBarControl =
  "inline-flex h-9 min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-sm text-topbar-foreground outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-60 aria-expanded:bg-white/10"

/**
 * One top-bar picker — the workspace and the project are both this.
 *
 * A popover list rather than a native select: each row carries a caption (the
 * role, the owner), the foot carries actions (settings, manage, create), and
 * past a handful of entries the list can be searched. Arrow keys, Enter and Esc
 * work throughout; the search field adds type-to-find.
 */
export function TopBarPicker({
  label,
  icon,
  items,
  activeValue,
  activeLabel,
  activeCaption,
  onSelect,
  busy = false,
  emptyMessage,
  footer,
  className,
}: Readonly<{
  /** What is being picked — "Workspace", "Project". Names the control. */
  label: string
  icon: React.ReactNode
  items: PickerItem[]
  activeValue?: string
  activeLabel: string
  activeCaption?: string
  onSelect: (value: string) => void
  busy?: boolean
  emptyMessage: string
  /**
   * Actions under the list, as `TopBarPickerAction`s. Receives `close` so an
   * action can shut the menu before it navigates or opens a dialog.
   */
  footer?: (close: () => void) => React.ReactNode
  className?: string
}>) {
  const [open, setOpen] = useState(false)
  const commandRef = useRef<HTMLDivElement>(null)
  const searchable = items.length > SEARCH_THRESHOLD
  const close = () => setOpen(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        role="combobox"
        aria-label={`${label}: ${activeLabel}`}
        aria-haspopup="listbox"
        disabled={busy}
        className={cn(topBarControl, className)}
      >
        <span
          className="shrink-0 opacity-70 [&_svg]:size-3.5"
          aria-hidden="true"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : icon}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate font-medium" title={activeLabel}>
            {activeLabel}
          </span>
          {activeCaption ? (
            <span className="block truncate text-[0.6875rem] opacity-70">
              {busy ? "Switching…" : activeCaption}
            </span>
          ) : null}
        </span>
        <ChevronsUpDown
          className="size-3.5 shrink-0 opacity-70"
          aria-hidden="true"
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 p-0"
        // Focus the list itself (or its search), so arrow keys work at once.
        onOpenAutoFocus={(event) => {
          if (searchable) return
          event.preventDefault()
          commandRef.current?.focus()
        }}
      >
        <Command ref={commandRef} tabIndex={-1} className="outline-none">
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
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.label}</span>
                      {item.caption ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.caption}
                        </span>
                      ) : null}
                    </span>
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

/** A row in the picker's footer — kept visible while the list is searched. */
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
