import type { ViewKey } from "./prismaData";

export function buildPathForState(view: ViewKey, projectId: string) {
  switch (view) {
    case "dashboard":
      return "/dashboard";
    case "newProject":
      return "/projects/new";
    case "about":
      return "/about";
    case "adminReviews":
      return "/admin/reviews";
    case "registeredUsers":
      return "/admin/users";
    case "profile":
      return "/profile";
    case "projectDashboard":
      return `/projects/${encodeURIComponent(projectId)}`;
    case "imports":
      return `/projects/${encodeURIComponent(projectId)}/imports`;
    case "dedup":
      return `/projects/${encodeURIComponent(projectId)}/dedup`;
    case "screening":
      return `/projects/${encodeURIComponent(projectId)}/screening`;
    case "screeningReviewed":
      return `/projects/${encodeURIComponent(projectId)}/screening/reviewed`;
    case "fullText":
      return `/projects/${encodeURIComponent(projectId)}/full-text`;
    case "fullTextReviewed":
      return `/projects/${encodeURIComponent(projectId)}/full-text/reviewed`;
    case "pdfUpload":
      return `/projects/${encodeURIComponent(projectId)}/full-text/pdf-upload`;
    case "extraction":
      return `/projects/${encodeURIComponent(projectId)}/extraction`;
    case "extractionReviewed":
      return `/projects/${encodeURIComponent(projectId)}/extraction/reviewed`;
    case "consensus":
      return `/projects/${encodeURIComponent(projectId)}/extraction/consensus`;
    case "risk":
      return `/projects/${encodeURIComponent(projectId)}/risk`;
    case "exports":
      return `/projects/${encodeURIComponent(projectId)}/exports`;
    case "audit":
      return `/projects/${encodeURIComponent(projectId)}/audit`;
    case "settings":
      return `/projects/${encodeURIComponent(projectId)}/settings`;
    default:
      return "/";
  }
}
