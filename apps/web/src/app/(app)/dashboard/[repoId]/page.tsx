import { DashboardView } from "@/components/dashboard/dashboard-view";

export default async function Page({ params }: Readonly<{ params: Promise<{ repoId: string }> }>) {
  const { repoId } = await params;
  return <DashboardView repoId={repoId} />;
}
