import { notFound, redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/serverAuth";
import { canAccessProjectRoute } from "@/lib/serverStore";

type ProjectLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ projectId?: string }>;
};


export default async function ProjectLayout({ children, params }: ProjectLayoutProps) {
  const resolvedParams = await params;
  const projectId = resolvedParams.projectId ? decodeURIComponent(resolvedParams.projectId) : "";
  const userId = await getSessionUserId();

  if (!projectId) {
    notFound();
  }

  if (!userId) {
    redirect(`/sign-in?redirect=${encodeURIComponent(`/projects/${encodeURIComponent(projectId)}`)}`);
  }

  if (!canAccessProjectRoute(projectId, userId)) {
    notFound();
  }

  return children;
}
