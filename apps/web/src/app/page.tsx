import { redirect } from "next/navigation"

/**
 * `/` is not a page. The middleware already sends it to `/login` (signed out)
 * or `/projects` (signed in); this is the fallback if it ever runs without the
 * middleware. One entry screen means one click from codesage.dev to Asgardeo.
 */
export default function Home() {
  redirect("/login")
}
