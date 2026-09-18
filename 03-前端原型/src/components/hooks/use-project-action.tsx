"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Project } from "@/domain/models";
import { ServiceError } from "@/services/contracts";
import { useService } from "../providers";
import { Button } from "../ui/button";
import { ErrorMessage } from "../shared";

export function useProjectAction(project: Project) {
  const client = useQueryClient();
  const service = useService();
  const draftRevision = useRef<number | null>(null);
  const [reloaded, setReloaded] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const save = useMutation({
    mutationFn: (operation: (revision: number) => Promise<Project>) => operation(draftRevision.current ?? project.revision),
    onSuccess: async (next) => { draftRevision.current = null; setReloaded(false); setHasChanges(false); client.setQueryData(["project", next.id], next); await client.invalidateQueries({ queryKey: ["projects"] }); },
  });
  const reload = useMutation({ mutationFn: () => service.get(project.id), onSuccess: (next) => { client.setQueryData(["project", next.id], next); draftRevision.current = next.revision; setReloaded(true); save.reset(); } });
  return { ...save, discardDraft: () => { draftRevision.current = null; setReloaded(false); setHasChanges(false); save.reset(); reload.reset(); }, touch: () => { draftRevision.current ??= project.revision; setReloaded(false); setHasChanges(true); save.reset(); },
    feedback: <>{hasChanges && <p className="field-hint">当前输入尚未保存。</p>}{save.error && <ErrorMessage error={save.error} />}{reload.error && <ErrorMessage error={reload.error} />}{save.error instanceof ServiceError && save.error.code === "CONFLICT" && <Button variant="outline" type="button" disabled={reload.isPending} onClick={() => reload.mutate()}>保留输入，载入最新状态</Button>}{reloaded && <p className="field-hint">输入已保留。再次保存会用当前输入覆盖这一项，请确认后提交。</p>}{save.isSuccess && <p role="status" className="success-message">已保存</p>}</>,
  };
}
