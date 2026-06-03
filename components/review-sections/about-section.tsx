import { GitMerge, Info, ListChecks } from "lucide-react";
import { SectionTitle } from "@/components/prisma-review-ui";

export function AboutSection() {
  return (
    <div className="viewStack">
      <section className="overviewBand">
        <div>
          <p className="eyebrow">About Prismatica</p>
          <h1>Open Source PRISMA Review Platform</h1>
          <p className="subtle">Prismatica supports systematic-review teams from citation intake through screening, full-text review, extraction, audit, and PRISMA-oriented export checks.</p>
        </div>
        <a className="primaryButton" href="https://github.com/fwanderlingh/prismatica" target="_blank" rel="noreferrer">
          <GitMerge size={17} />
          GitHub
        </a>
      </section>

      <section className="aboutGrid">
        <div className="panel aboutPanel">
          <SectionTitle icon={Info} title="Purpose" action="Evidence workflow" />
          <p>
            Prismatica is built as a transparent, auditable workspace for PRISMA-style (Preferred Reporting Items for Systematic reviews and Meta-Analyses) review projects. It keeps project membership, imports, decisions, PDF metadata,
            extraction templates, and audit events behind server APIs while preserving a reviewer-friendly interface for day-to-day screening work.
          </p>
          <p>
            Full information about the PRISMA guidelines can be found at <a href="https://www.prisma-statement.org" target="_blank" rel="noreferrer">https://www.prisma-statement.org</a>.
          </p>
          <div className="aboutPurposeLogo" aria-hidden="true">
            <img src="/icon.svg" alt="Prismatica logo" />
          </div>
        </div>

        <div className="panel aboutPanel">
          <SectionTitle icon={GitMerge} title="Source Code" action="Public repository" />
          <p>The website source is available in the public GitHub repository.</p>
          <a className="repoLink" href="https://github.com/fwanderlingh/prismatica" target="_blank" rel="noreferrer">
            github.com/fwanderlingh/prismatica
          </a>
        </div>
      </section>

      <section className="panel">
        <SectionTitle icon={ListChecks} title="What It Covers" action="Current app surface" />
        <div className="aboutFeatureGrid">
          {[
            ["Project governance", "Review setup, membership, owner controls, blind mode, vote thresholds, and registration security."],
            ["Citation workflow", "RIS/BibTeX import, parser warning review, deduplication workspace, and title/abstract screening."],
            ["Full-text review", "Report queues, PDF upload, DOI links, retrieval status, exclusion reasons, and conflict handling."],
            ["Audit and export", "Append-only workflow events, paged audit history, PRISMA count preview, and export validation checks."]
          ].map(([title, description]) => (
            <article className="aboutFeature" key={title}>
              <strong>{title}</strong>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
