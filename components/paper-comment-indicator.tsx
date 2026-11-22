import { MessageSquare } from "lucide-react";
import type { Study } from "@/lib/prismaData";

export function PaperCommentIndicator({ study }: { study?: Pick<Study, "comments"> }) {
  const count = study?.comments?.filter((comment) => comment.text.trim()).length ?? 0;
  if (count === 0) return null;
  const label = `${count} paper comment${count === 1 ? "" : "s"}`;
  return <span className="paperCommentIndicator" role="img" aria-label={label} title={label}>
    <MessageSquare size={15} aria-hidden="true" />
  </span>;
}
