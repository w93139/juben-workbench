import { notFound } from "next/navigation";
import { WorkspacePage } from "@/components/workspace";
import { stageIdSchema } from "@/domain/models";
export default async function StagePage({ params }: { params: Promise<{ projectId: string; stageId: string }> }) {
  const { projectId, stageId } = await params;
  const parsed = stageIdSchema.safeParse(stageId);
  if (!parsed.success) notFound();
  return <WorkspacePage projectId={projectId} stageId={parsed.data} />;
}
