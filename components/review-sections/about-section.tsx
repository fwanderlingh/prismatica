"use client";

import { Fragment, useState } from "react";
import { Accessibility, Check, Copy, GitMerge, Info, ListChecks } from "lucide-react";
import { SectionTitle } from "@/components/prisma-review-ui";

const navigationShortcuts = [
  { title: "Move between links and controls", detail: "Go forward or back through the page.", keys: [["Tab"], ["Shift", "Tab"]] },
  { title: "Skip to main content", detail: "On a fresh page load, press Tab then Enter to bypass the header and sidebar. After navigating within the website, focus moves directly to the main content; Tab continues through its controls.", keys: [["Tab"], ["Enter"]], separator: "then" },
  { title: "Open the account menu or select an item", detail: "With the account button or a menu item focused.", keys: [["Enter"], ["Space"]] },
  { title: "Move through the account menu", detail: "Go to the previous or next item.", keys: [["↑"], ["↓"]] },
  { title: "Jump to the first or last menu item", detail: "With the account menu open.", keys: [["Home"], ["End"]] },
  { title: "Find a menu item by its initial", detail: "Jump to Profile or About in the account menu.", keys: [["P"], ["A"]] },
  { title: "Close the account menu", detail: "Return focus to its button. Tab or Shift + Tab also closes the menu and moves to another control.", keys: [["Esc"]] }
];

const keyLabels: Record<string, string> = { "↑": "Up arrow", "↓": "Down arrow", Esc: "Escape" };

const softwareBibtex = [
  "@misc{prismatica,",
  "  author = {Wanderlingh, Francesco},",
  "  title = {{PRISMATICA}: an open-source web platform for {PRISMA}-guided systematic reviews},",
  "  year = {2026},",
  "  howpublished = {\\url{https://github.com/fwanderlingh/prismatica}},",
  "  note = {Version 1.1.0}",
  "}"
].join("\n");

export function AboutSection() {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");

  async function copyBibtex() {
    try {
      await navigator.clipboard.writeText(softwareBibtex);
      setCopyStatus("copied");
    } catch {
      // Support browsers where the Clipboard API is unavailable or blocked.
      const previousFocus = document.activeElement as HTMLElement | null;
      const textarea = document.createElement("textarea");
      textarea.value = softwareBibtex;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      textarea.setAttribute("readonly", "");
      document.body.appendChild(textarea);
      textarea.select();
      try {
        setCopyStatus(document.execCommand("copy") ? "copied" : "error");
      } catch {
        setCopyStatus("error");
      } finally {
        textarea.remove();
        previousFocus?.focus({ preventScroll: true });
      }
    }
  }

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
          <div className="aboutCitation">
            <strong>Citing PRISMATICA</strong>
            <p>If you use PRISMATICA in a systematic review or other research project, please cite the software:</p>
            <p><em>Francesco Wanderlingh. PRISMATICA: an open-source web platform for PRISMA-guided systematic reviews. Version 1.1.0.</em></p>
            <div className="aboutCitationSnippet">
              <div className="aboutCitationToolbar">
                <strong>BibTeX</strong>
                <button className="ghostButton" type="button" onClick={copyBibtex} aria-label="Copy BibTeX citation">
                  {copyStatus === "copied" ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                  {copyStatus === "copied" ? "Copied" : "Copy"}
                </button>
              </div>
              <pre aria-label="BibTeX citation"><code>{softwareBibtex}</code></pre>
            </div>
            <span role="status">
              {copyStatus === "copied" ? "BibTeX citation copied." : copyStatus === "error" ? "Copy was unavailable. Select the BibTeX text and copy it manually." : ""}
            </span>
          </div>
        </div>
      </section>

      <section className="panel">
        <SectionTitle icon={ListChecks} title="What It Covers" action="Current app surface" />
        <div className="aboutFeatureGrid">
          {[
            ["Project governance", "Review setup, membership, owner controls, blind mode, vote thresholds, and registration security."],
            ["Citation workflow", "RIS/BibTeX import, parser warning review, deduplication workspace, and title/abstract screening."],
            ["Full-text review", "Report queues, individual and bulk PDF upload, DOI links, retrieval status, exclusion reasons, and conflict handling."],
            ["Audit and export", "Append-only workflow events, paged audit history, PRISMA count preview, and export validation checks."]
          ].map(([title, description]) => (
            <article className="aboutFeature" key={title}>
              <strong>{title}</strong>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel aboutPanel">
        <SectionTitle icon={Accessibility} title="Website Navigation" action="Keyboard guide" />
        <p>
          Use the sidebar and breadcrumbs to open pages, including in a new tab. You can also navigate with your keyboard:
          focus outlines show your position, and Enter follows a focused page link.
        </p>
        <ul className="shortcutGuide" aria-label="Navigation shortcuts">
          {navigationShortcuts.map(({ title, detail, keys, separator = "or" }) => (
            <li key={title}>
              <div className="shortcutDescription">
                <strong>{title}</strong>
                <p>{detail}</p>
              </div>
              <span className="shortcutKeys">
                {keys.map((group, groupIndex) => (
                  <Fragment key={group.join("+")}>
                    {groupIndex > 0 ? <span className="shortcutSeparator">{separator}</span> : null}
                    <span className="shortcutKeyGroup">
                      {group.map((key, keyIndex) => (
                        <Fragment key={key}>
                          {keyIndex > 0 ? <span className="shortcutSeparator">+</span> : null}
                          <kbd aria-label={keyLabels[key]}>{key}</kbd>
                        </Fragment>
                      ))}
                    </span>
                  </Fragment>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel aboutPanel">
        <SectionTitle icon={Info} title="PDF Upload Disclaimer" action="Usage policy" />
        <p>
          Users may upload PDFs only if they have the right to use them in this project. Uploaded PDFs are stored for private review workflows only and must not be shared outside authorized project members. Users should prefer
          open-access versions, author-accepted manuscripts, or official DOI links where available.
        </p>
      </section>
    </div>
  );
}
