import { notFound } from "next/navigation";
import { PrismaReviewAppClient } from "@/components/prisma-review-app-client";
import { ApiError, getAppStateForUser } from "@/lib/serverStore";
import { requireSessionUserId } from "@/lib/serverRoute";

type CatchAllPageProps = {
  params:
    | {
        slug?: string[];
      }
    | Promise<{
        slug?: string[];
      }>;
};

async function resolveParams(params: CatchAllPageProps["params"]) {
  return params instanceof Promise ? await params : params;
}

const validStaticRoutes = new Set([
  "about",
  "profile",
  "sign-in"
]);

const validProjectSubroutes = new Set([
  "imports",
  "dedup",
  "screening",
  "screen/title-abstract",
  "full-text",
  "extraction",
  "extraction/consensus",
  "risk",
  "exports",
  "audit",
  "settings"
]);

function isKnownCatchAllRoute(slug: string[]) {
  if (slug.length === 0) {
    return true;
  }

  const joined = slug.join("/");
  if (validStaticRoutes.has(joined)) {
    return true;
  }

  if (joined === "projects/new" || joined === "admin/reviews" || joined === "admin/users") {
    return true;
  }

  if (slug[0] !== "projects" || !slug[1] || slug[1] === "new") {
    return false;
  }

  if (slug.length === 2) {
    return true;
  }

  return validProjectSubroutes.has(slug.slice(2).join("/"));
}

function getRequestedProjectId(slug: string[]) {
  if (slug[0] !== "projects" || !slug[1] || slug[1] === "new") {
    return null;
  }
  return decodeURIComponent(slug[1]);
}

async function assertProjectAccessIfAuthenticated(projectId: string) {
  try {
    const userId = await requireSessionUserId();
    const appState = getAppStateForUser(userId);
    const canAccessProject = appState.projects.some((project) => project.id === projectId);
    if (!canAccessProject) {
      notFound();
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return;
    }
    throw error;
  }
}

export default async function CatchAllPage({ params }: CatchAllPageProps) {
  const resolvedParams = await resolveParams(params);
  const slug = resolvedParams.slug ?? [];
  if (!isKnownCatchAllRoute(slug)) {
    notFound();
  }

  const requestedProjectId = getRequestedProjectId(slug);
  if (requestedProjectId) {
    await assertProjectAccessIfAuthenticated(requestedProjectId);
  }

  return <PrismaReviewAppClient />;
}
