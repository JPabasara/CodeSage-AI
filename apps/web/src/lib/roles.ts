import type { Role } from "@/lib/types"

/** How each workspace role reads on screen. One map, so labels cannot drift. */
export const ROLE_LABEL: Record<string, string> = {
  "org-admin": "Org admin",
  manager: "Manager",
  developer: "Developer",
  viewer: "Viewer",
} satisfies Record<Role, string>

/** Every role, most to least privileged — the order a role picker lists them. */
export const ROLES: Role[] = ["org-admin", "manager", "developer", "viewer"]
