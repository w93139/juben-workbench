import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { blankDecisions, demoContentSchema, envelopeSchema, projectSchema } from "../../src/domain/models";
import { emptyResearch } from "../../src/domain/research";

// Fixtures are schema-validated in Node. The product has no test-only creation
// endpoint; existing browser projects are retained. Real folder creation is
// exercised independently in folder-entry.spec.ts.
export async function seedProject(page: Page, title: string, demo = false, note = "") {
  await page.goto("/");
  const key = "juben-workbench:projects:v1";
  const raw = await page.evaluate((key) => localStorage.getItem(key), key);
  const envelope = envelopeSchema.parse(raw ? JSON.parse(raw) : { schemaVersion: 3, projects: [] });
  const time = new Date().toISOString();
  const decisions = demo ? demoContentSchema.parse(JSON.parse(readFileSync(new URL("../../src/mocks/names-beyond.json", import.meta.url), "utf8"))).decisions : blankDecisions;
  const project = projectSchema.parse({ title, note, template: demo ? "names-beyond" : "blank", id: `project-${randomUUID()}`, revision: 0, readOnly: false, createdAt: time, updatedAt: time, research: emptyResearch(), decisions });
  envelope.projects.push(project);
  const next = JSON.stringify(envelopeSchema.parse(envelope));
  await page.evaluate(({ key, next }) => localStorage.setItem(key, next), { key, next });
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  return page.url();
}
