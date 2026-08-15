import {
  asgardeoMiddleware,
  createRouteMatcher,
} from "@asgardeo/nextjs/middleware"

const isProtectedRoute = createRouteMatcher([
  "/projects(.*)",
  "/dashboard(.*)",
  "/profiles(.*)",
  "/team(.*)",
])

export const proxy = asgardeoMiddleware(async (asgardeo, request) => {
  if (isProtectedRoute(request)) {
    await asgardeo.protectRoute({ redirect: "/login" })
  }
})

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
}
