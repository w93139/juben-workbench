"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Project } from "@/domain/models";
import { ServiceError } from "@/services/contracts";
import { useService } from "../providers";
import { ErrorMessage } from "../shared";
import { Button } from "../ui/button";

export function useProductionRunner(project?: Project) {
  const service = useService();
  const client = useQueryClient();
  const [failure, setFailure] = useState<{ projectId: string; taskId: string; error: unknown } | null>(null);
  const job = project?.production?.jobs.find((item) => item.status === "running");
  const review = project?.production?.reviews.find((item) => item.models.some((model) => model.status === "running"));
  const model = review?.models.find((item) => item.status === "running");
  const taskId = job?.id ?? (review && model ? `${review.id}:${model.id}` : null);
  const paused = !!taskId && failure?.projectId === project?.id && failure?.taskId === taskId;
  useEffect(() => {
    if (!project || project.readOnly || paused || (!job && !model)) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const next = job
          ? await service.advanceGeneration(project.id, project.revision, job.id)
          : await service.advanceReviewModel(project.id, project.revision, review!.id, model!.id);
        client.setQueryData(["project", project.id], next);
        void client.invalidateQueries({ queryKey: ["projects"] });
      } catch (error) {
        if (error instanceof ServiceError && error.code === "CONFLICT") void client.invalidateQueries({ queryKey: ["project", project.id] });
        else if (active) setFailure({ projectId: project.id, taskId: taskId!, error });
      }
    }, 900);
    return () => { active = false; clearTimeout(timer); };
  }, [project, job, review, model, taskId, paused, client, service]);
  return paused ? <section className="panel" aria-label="模拟任务保存失败"><ErrorMessage error={failure?.error} /><p className="field-hint">任务停在上次已保存的位置，恢复后继续，不会跳过失败的保存。</p><Button className="mt-3" variant="outline" onClick={() => setFailure(null)}>继续保存生成与检查进度</Button></section> : null;
}
