import { projectSchema, type Project } from "@/domain/models";
import { emptyResearch } from "@/domain/research";
import snapshot from "@/mocks/names-beyond.json";

// Application-owned read-only sample metadata; never executes simulated jobs.
export const baseline: Project = projectSchema.parse({
  id: "demo-names", title: snapshot.title, note: "完整原创样例。先浏览设计结构，再创建副本记录自己的创作决定。",
  template: "names-beyond", readOnly: true, revision: 0, createdAt: null, updatedAt: null,
  decisions: snapshot.decisions, research: emptyResearch(),
});
