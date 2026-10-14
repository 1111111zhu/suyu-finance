import { redirect } from "next/navigation";

/** Retired project overview: use the single project-management workbench. */
export default async function ProjectsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  redirect(params.embed === "1" ? "/projects/platforms?embed=1" : "/?section=rd-platforms");
}
