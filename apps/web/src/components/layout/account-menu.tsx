"use client"

import { useRef, useState } from "react"
import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useSession } from "@/hooks/use-session"
import { markSignedOut } from "@/lib/sign-in"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"

/** Up to two letters for the avatar; a provider may give no name or email. */
export function initialsOf(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.split("@")[0] || ""
  const letters = source
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("")
  return letters || "?"
}

/**
 * The avatar at the right of the top bar: who is signed in, and with what.
 * Theme and Sign out live at the foot of the rail, where they are always one
 * click away rather than hidden behind the avatar.
 */
export function AccountMenu() {
  const { data: session } = useSession()
  const name = session?.name?.trim() || "Signed in"
  const provider = session?.identity_provider

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="grid size-9 shrink-0 place-items-center rounded-full border border-white/25 bg-white/15 text-xs font-semibold text-topbar-foreground outline-none transition-colors hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-white/70"
      >
        {initialsOf(session?.name, session?.email)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm font-medium text-foreground">
            {name}
          </span>
          {session?.email ? (
            <span className="block truncate text-xs text-muted-foreground">
              {session.email}
            </span>
          ) : null}
          {provider ? (
            <span className="mt-1 block text-xs text-muted-foreground">
              Signed in with {provider[0]!.toUpperCase() + provider.slice(1)}
            </span>
          ) : null}
        </DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The theme choices, in the order the menu offers them. */
export const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System default", icon: Monitor },
] as const

/** Light, Dark or System default, as radio items inside any dropdown. */
export function ThemeRadioItems() {
  const { theme, setTheme } = useTheme()
  return (
    <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
      {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
        <DropdownMenuRadioItem key={value} value={value}>
          <Icon aria-hidden="true" />
          {label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}

/**
 * "Sign out of CodeSage?", asked once in a centred dialog, because it is the
 * one action in the shell that cannot be undone with a click.
 */
export function SignOutDialog({
  open,
  onOpenChange,
}: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void }>) {
  const [signingOut, setSigningOut] = useState(false)
  const signOutRef = useRef<HTMLButtonElement>(null)

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!signingOut) onOpenChange(next)
      }}
    >
      <AlertDialogContent
        // Sign out has the focus, so Enter confirms; Esc and Cancel close.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          signOutRef.current?.focus()
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Sign out of CodeSage?</AlertDialogTitle>
          <AlertDialogDescription>
            You&apos;ll sign in with Asgardeo again to come back.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {/*
          A form the browser submits, not a fetch: sign-out has to end the
          session at the identity provider too, which only a navigation can
          do. POST, so nothing prefetches it on a guess.
        */}
        <form
          id="sign-out-form"
          action={`${API_BASE}/api/auth/logout`}
          method="POST"
          onSubmit={() => {
            markSignedOut()
            setSigningOut(true)
          }}
        />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={signingOut}>Cancel</AlertDialogCancel>
          <Button
            ref={signOutRef}
            type="submit"
            form="sign-out-form"
            disabled={signingOut}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
