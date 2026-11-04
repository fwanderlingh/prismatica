import { ViewLink } from "@/components/navigation-link";
import { useState, type ReactNode } from "react";
import type { Study, ViewKey } from "@/lib/prismaData";
import { formatReviewDateTime } from "@/lib/reviewDisplay";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, ArrowLeft, Check, RotateCcw } from "lucide-react";
import { Badge, EmptyState, SectionTitle, renderDoiLink } from "@/components/prisma-review-ui";

export type ReviewedQueueItem = {
  id: string;
  title: string;
  subtitle: string;
  detail?: string;
  statusLabel: string;
  statusTone: "success" | "warning" | "danger" | "info" | "neutral";
  completedAt?: string;
  study?: Study;
  filterValue?: string;
};

type ReviewedItemsSectionProps = {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  queueLabel: string;
  queueView: ViewKey;
  emptyTitle: string;
  emptyDescription: string;
  items: ReviewedQueueItem[];
  statusFilters?: { value: string; label: string }[];
  filterLabel?: string;
  message: string;
  pendingItemId: string;
  actionLabel: string;
  onOpenQueue: () => void;
  onReturnToQueue: (itemId: string) => void;
  children?: ReactNode;
};

export function ReviewedItemsSection({
  icon: Icon,
  eyebrow,
  title,
  description,
  queueLabel,
  queueView,
  emptyTitle,
  emptyDescription,
  items,
  statusFilters,
  filterLabel = "Status",
  message,
  pendingItemId,
  actionLabel,
  onOpenQueue,
  onReturnToQueue,
  children
}: ReviewedItemsSectionProps) {
  const [statusFilter, setStatusFilter] = useState("all");
  const visibleItems = statusFilters && statusFilter !== "all"
    ? items.filter((item) => item.filterValue === statusFilter)
    : items;
  const messageIsSuccess = /returned|queue|saved|updated/i.test(message);
  const messageIsError = /already|cannot|denied|duplicate|error|failed|forbidden|invalid|no longer|not found|required|unauthorized/i.test(message);
  const messageClassName = messageIsSuccess ? "validationItem ok" : messageIsError ? "validationItem blocked" : "validationItem muted";

  return (
    <div className="viewStack">
      <section className="overviewBand compactBand">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="subtle">{description}</p>
        </div>
        <div className="buttonRow">
          <ViewLink view={queueView} className="ghostButton" onNavigate={onOpenQueue}>
            <ArrowLeft size={17} />
            {queueLabel}
          </ViewLink>
        </div>
      </section>

      {message ? (
        <div className={messageClassName}>
          {messageIsSuccess ? <Check size={17} /> : <AlertTriangle size={17} />}
          <span>{message}</span>
        </div>
      ) : null}

      {children}
      <section className="panel">
        <SectionTitle icon={Icon} title="Reviewed Items" action={`${items.length} completed`} />
        {statusFilters ? (
          <div className="reviewedItemsFilters">
            <label>
              <span>{filterLabel}</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">All ({items.length})</option>
                {statusFilters.map((filter) => (
                  <option key={filter.value} value={filter.value}>
                    {filter.label} ({items.filter((item) => item.filterValue === filter.value).length})
                  </option>
                ))}
              </select>
            </label>
            <span className="subtle" role="status">Showing {visibleItems.length} of {items.length}</span>
          </div>
        ) : null}
        {visibleItems.length > 0 ? (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Status</th>
                  <th>Completed</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => {
                  const isPending = pendingItemId === item.id;
                  return (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.title}</strong>
                        <span>{item.subtitle}</span>
                        {item.detail ? <span>{item.detail}</span> : null}
                        {item.study ? (
                          <div className="reviewedItemDoi">{renderDoiLink(item.study.doi, `DOI ${item.study.doi || "Missing"}`, item.study)}</div>
                        ) : null}
                      </td>
                      <td>
                        <Badge label={item.statusLabel} tone={item.statusTone} />
                      </td>
                      <td>{item.completedAt ? formatReviewDateTime(item.completedAt) : "Recorded"}</td>
                      <td>
                        <button
                          className="ghostButton"
                          type="button"
                          disabled={Boolean(pendingItemId)}
                          onClick={() => onReturnToQueue(item.id)}
                        >
                          {isPending ? <span className="inlineSpinner" aria-hidden="true" /> : <RotateCcw size={17} />}
                          {isPending ? "Returning..." : actionLabel}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={Icon}
            title={items.length > 0 ? "No matching reviewed items" : emptyTitle}
            description={items.length > 0 ? "Choose another status or All to view your other reviewed items." : emptyDescription}
          />
        )}
      </section>
    </div>
  );
}
