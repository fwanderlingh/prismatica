import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Archive,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Database,
  Eye,
  FileSearch,
  FileText,
  GitMerge,
  ListChecks,
  XCircle
} from "lucide-react";
import type { PrismaCounts, Study } from "@/lib/prismaData";

const numberFormatter = new Intl.NumberFormat("en-US");

export function SectionTitle({ icon: Icon, title, action }: { icon: LucideIcon; title: string; action: string }) {
  return (
    <div className="sectionTitle">
      <div>
        <Icon size={18} />
        <h2>{title}</h2>
      </div>
      <span>{action}</span>
    </div>
  );
}

export function Metric({
  label,
  value,
  detail,
  tone
}: {
  label: string;
  value: string;
  detail: string;
  tone: "blue" | "teal" | "amber" | "green";
}) {
  return (
    <article className={`metricCard ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

export function StatusRow({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone: "secure" | "info" | "warning" | "danger";
}) {
  return (
    <div className={`statusRow ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function Badge({ label, tone }: { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" }) {
  return <span className={`badge ${tone}`}>{label}</span>;
}

export function EmptyState({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <div className="emptyState">
      <Icon size={28} />
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

export function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="scoreBar">
      <div>
        <span>{label}</span>
        <strong>{Math.round(value * 100)}%</strong>
      </div>
      <i>
        <b style={{ width: `${Math.round(value * 100)}%` }} />
      </i>
    </div>
  );
}

export function RecordComparison({ title, source, study }: { title: string; source: string; study: Study }) {
  return (
    <article className="panel recordCard">
      <SectionTitle icon={Archive} title={title} action={source} />
      <dl>
        <div>
          <dt>Title</dt>
          <dd>{study.title}</dd>
        </div>
        <div>
          <dt>Authors</dt>
          <dd>{study.authors.join(", ")}</dd>
        </div>
        <div>
          <dt>Journal</dt>
          <dd>{study.journal}</dd>
        </div>
        <div>
          <dt>Year</dt>
          <dd>{study.year}</dd>
        </div>
        <div>
          <dt>DOI</dt>
          <dd>{renderDoiLink(study.doi, study.doi || "Missing")}</dd>
        </div>
      </dl>
    </article>
  );
}

export function renderDoiLink(value: string, label?: string) {
  const normalizedValue = value.trim().replace(/^https?:\/\/doi\.org\//i, "").replace(/^doi:\s*/i, "");
  if (!normalizedValue) {
    return label ?? "Missing";
  }

  return (
    <a href={`https://doi.org/${normalizedValue}`} target="_blank" rel="noreferrer">
      {label ?? normalizedValue}
    </a>
  );
}

export function PrismaFlow({ counts, reportsExcludedTotal }: { counts: PrismaCounts; reportsExcludedTotal: number }) {
  const recordsIdentifiedTotal = counts.recordsIdentifiedDatabase + counts.recordsIdentifiedRegisters + counts.recordsIdentifiedOther;

  return (
    <div className="prismaFlow">
      <div className="flowLane" aria-label="PRISMA main flow">
        <h4>Main review path</h4>
        <ol className="flowMainList">
          <li className="flowMainStep">
            <FlowBox label="Records identified (all sources)" value={recordsIdentifiedTotal} icon={Database} tone="blue" />
          </li>
          <li className="flowMainStep">
            <FlowBox label="Records screened" value={counts.recordsScreened} icon={Eye} tone="blue" />
          </li>
          <li className="flowMainStep">
            <FlowBox label="Reports sought for retrieval" value={counts.reportsSought} icon={BookOpen} tone="blue" />
          </li>
          <li className="flowMainStep">
            <FlowBox label="Reports assessed for eligibility" value={counts.reportsAssessed} icon={FileSearch} tone="blue" />
          </li>
          <li className="flowMainStep">
            <FlowBox label="Studies included in review" value={counts.studiesIncluded} icon={CheckCircle2} tone="green" />
          </li>
        </ol>
      </div>

      <div className="flowBranches" aria-label="PRISMA branch outcomes">
        <div className="flowBranch">
          <h4>Pre-screen removals</h4>
          <div className="flowBranchGrid">
            <FlowBox label="Duplicate records removed" value={counts.duplicateRecordsRemoved} icon={GitMerge} tone="teal" />
            <FlowBox label="Removed by automation or other reasons" value={counts.automationRemoved + counts.removedOtherReasons} icon={AlertTriangle} tone="amber" />
          </div>
        </div>

        <div className="flowBranch">
          <h4>Downstream outcomes</h4>
          <div className="flowBranchGrid">
            <FlowBox label="Records excluded" value={counts.recordsExcluded} icon={XCircle} tone="coral" />
            <FlowBox label="Reports not retrieved" value={counts.reportsNotRetrieved} icon={AlertTriangle} tone="amber" />
            <FlowBox label="Reports excluded with reasons" value={reportsExcludedTotal} icon={ListChecks} tone="coral" />
            <FlowBox label="Included for extraction" value={counts.studiesIncluded} icon={BarChart3} tone="green" />
          </div>
        </div>
      </div>
    </div>
  );
}

function FlowBox({
  label,
  value,
  icon: Icon,
  tone = "neutral"
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone?: "neutral" | "blue" | "teal" | "amber" | "coral" | "green";
}) {
  return (
    <div className={`flowBox ${tone}`}>
      <Icon size={18} />
      <span>{label}</span>
      <strong>{formatNumber(value)}</strong>
    </div>
  );
}

function formatNumber(value: number) {
  return numberFormatter.format(value);
}
