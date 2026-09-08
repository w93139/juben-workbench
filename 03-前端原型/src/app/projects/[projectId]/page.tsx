import { WorkspacePage } from "@/components/workspace";
export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <WorkspacePage projectId={projectId} />;
}
