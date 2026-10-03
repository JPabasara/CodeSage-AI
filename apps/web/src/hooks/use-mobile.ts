import * as React from "react"

const MOBILE_BREAKPOINT = 768
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

let mediaQueryList: MediaQueryList | null = null

function getMediaQueryList() {
  mediaQueryList ??= window.matchMedia(MOBILE_QUERY)
  return mediaQueryList
}

function subscribe(onStoreChange: () => void) {
  const mql = getMediaQueryList()
  mql.addEventListener("change", onStoreChange)
  return () => mql.removeEventListener("change", onStoreChange)
}

function getSnapshot() {
  return getMediaQueryList().matches
}

// The server has no viewport, so assume desktop.
function getServerSnapshot() {
  return false
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
