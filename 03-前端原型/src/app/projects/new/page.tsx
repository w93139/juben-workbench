import { CreateProjectPage } from "@/components/create-project";
export default async function NewProject({ searchParams }: { searchParams: Promise<{ template?: string; start?: string }> }) {
  const { template, start } = await searchParams;
  return <CreateProjectPage fromDemo={template === "demo"} startResearch={start === "research"} />;
}
