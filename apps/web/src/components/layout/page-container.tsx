import { cn } from "@/lib/utils"

/**
 * The one page frame. Every page starts its title at the same place, so moving
 * between pages never shifts the content sideways.
 */
export const PAGE_GUTTER = "px-4 sm:px-7"

export const PAGE_CONTAINER = cn(
  "mx-auto flex w-full max-w-[90rem] flex-col gap-6 py-5 sm:py-6",
  PAGE_GUTTER,
)

export function PageContainer({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return <div className={cn(PAGE_CONTAINER, className)} {...props} />
}
