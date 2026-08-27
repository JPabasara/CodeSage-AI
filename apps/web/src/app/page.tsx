import { redirect } from "next/navigation"

export default function Home() {
  redirect("/projects") // later: redirect to /login when signed out
}
