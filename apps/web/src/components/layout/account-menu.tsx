"use client"

import { useRef, useState } from "react"
import { LogOut, Monitor, Moon, Sun } from "lucide-react"
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
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
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
 * The avatar at the right of the top bar: who is signed in, the theme, and a
 * way out. Signing out asks once, in a centred dialog — the one action here that
 * cannot be undone with a click.
 */
export function AccountMenu() {
  const { data: session } = useSession()
  const { theme, setTheme } = useTheme()
  const [confirming, setConfirming] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const signOutRef = useRef<HTMLButtonElement>(null)

  const name = session?.name?.trim() || "Signed in"
  const provider = session?.identity_provider

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Account menu"
          className="grid size-9 shrink-0 place-items-center rounded-full border border-white/25 bg-white/15 text-xs font-semibold text-topbar-foreground outline-none transition-colors hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-white/70"
        >
          {initialsOf(session?.name, session?.email)}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-64"
          // The dialog takes focus next; handing it back to the avatar first
          // would pull it out of the dialog it just opened.
          onCloseAutoFocus={(event) => {
            if (confirming) event.preventDefault()
          }}
        >
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
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Theme
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={theme ?? "system"}
            onValueChange={setTheme}
          >
            <DropdownMenuRadioItem value="light">
              <Sun aria-hidden="true" />
              Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <Moon aria-hidden="true" />
              Dark
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">
              <Monitor aria-hidden="true" />
              System
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setConfirming(true)}>
            <LogOut aria-hidden="true" />
            Sign out…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!signingOut) setConfirming(open)
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
    </>
  )
}
