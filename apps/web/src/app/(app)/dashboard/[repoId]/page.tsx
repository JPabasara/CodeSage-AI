export default async function Page({ params }: Readonly<{ params: Promise<{ repoId: string }> }>) {
  const { repoId } = await params;
  return <h1>Dashboard — {repoId}</h1>;
}