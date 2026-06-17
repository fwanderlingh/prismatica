import { notFound } from "next/navigation";
import { getSessionUserId } from "@/lib/serverAuth";
import { canAccessProjectRoute } from "@/lib/serverStore";

type ProjectLayoutProps = {
  children: React.ReactNode;
  params:
    | {
        projectId?: string;
      }
    | Promise<{
        projectId?: string;
      }>;
};

async function resolveParams(params: ProjectLayoutProps["params"]) {
  return params instanceof Promise ? await params : params;
}

export default async function ProjectLayout({ children, params }: ProjectLayoutProps) {
  const resolvedParams = await resolveParams(params);
  const projectId = resolvedParams.projectId ? decodeURIComponent(resolvedParams.projectId) : "";
  const userId = await getSessionUserId();

  if (!projectId || !canAccessProjectRoute(projectId, userId)) {
    notFound();
  }

  return children;
}
