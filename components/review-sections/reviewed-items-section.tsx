import type { LucideIcon } from "lucide-react";
import { AlertTriangle, ArrowLeft, Check, RotateCcw } from "lucide-react";
import { Badge, EmptyState, SectionTitle } from "@/components/prisma-review-ui";

export type ReviewedQueueItem = {
  id: string;
  title: string;
  subtitle: string;
  detail?: string;
  statusLabel: string;
  statusTone: "success" | "warning" | "danger" | "info" | "neutral";
  completedAt?: string;
};

type ReviewedItemsSectionProps = {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  queueLabel: string;
  emptyTitle: string;
  emptyDescription: string;
  items: ReviewedQueueItem[];
  message: string;
  pendingItemId: string;
  actionLabel: string;
  onOpenQueue: () => void;
  onReturnToQueue: (itemId: string) => void;
};

export function ReviewedItemsSection({
  icon: Icon,
  eyebrow,
  title,
  description,
  queueLabel,
  emptyTitle,
  emptyDescription,
  items,
  message,
  pendingItemId,
  actionLabel,
  onOpenQueue,
  onReturnToQueue
}: ReviewedItemsSectionProps) {
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
          <button className="ghostButton" type="button" onClick={onOpenQueue}>
            <ArrowLeft size={17} />
            {queueLabel}
          </button>
        </div>
      </section>

      {message ? (
        <div className={messageClassName}>
          {messageIsSuccess ? <Check size={17} /> : <AlertTriangle size={17} />}
          <span>{message}</span>
        </div>
      ) : null}

      <section className="panel">
        <SectionTitle icon={Icon} title="Reviewed Items" action={`${items.length} completed`} />
        {items.length > 0 ? (
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
                {items.map((item) => {
                  const isPending = pendingItemId === item.id;
                  return (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.title}</strong>
                        <span>{item.subtitle}</span>
                        {item.detail ? <span>{item.detail}</span> : null}
                      </td>
                      <td>
                        <Badge label={item.statusLabel} tone={item.statusTone} />
                      </td>
                      <td>{item.completedAt ?? "Recorded"}</td>
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
          <EmptyState icon={Icon} title={emptyTitle} description={emptyDescription} />
        )}
      </section>
    </div>
  );
}
