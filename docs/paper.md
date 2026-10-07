---
title: "Prismatica: An Open-Source Platform for Collaborative Evidence Review"
tags:
  - systematic reviews
  - evidence synthesis
  - PRISMA
  - open source
authors:
  - name: Francesco Wanderlingh
    affiliation: 1
affiliations:
  - name: University of Genoa
    index: 1
date: 7 October 2026
bibliography: paper.bib
---

# Summary

Systematic reviews require researchers to coordinate record screening, full-text assessment, data extraction, and decisions across multiple reviewers. Prismatica is an open-source, web-based platform that brings these activities into a shared project workflow. The software is available under the MIT License, and its source code is hosted at [github.com/fwanderlingh/prismatica](https://github.com/fwanderlingh/prismatica).

Reviewers can import references in RIS and BibTeX formats, inspect duplicate candidates, screen titles and abstracts, and progress eligible records to full-text review. Teams can upload and validate PDFs, resolve conflicts, define extraction templates, submit extraction data, and build consensus using configurable voting. Project dashboards show progress, while provenance and audit records help teams inspect review activity. Validation and export endpoints support preparation of review outputs. The workflow is informed by the PRISMA 2020 reporting guideline [@page2021prisma]; Prismatica is a workflow tool, not a substitute for methodological judgment or the guideline itself.

Prismatica is implemented with Next.js, React, and TypeScript. Next.js route handlers expose the application API, with server-side authentication and project-permission checks. Workflow logic is implemented in server-side modules. The platform supports local JSON-file or PostgreSQL state storage, and local or S3-compatible storage for PDFs. The README documents local installation and configuration. The repository also includes TypeScript, API authorization, audit-history, and progress checks.

# Statement of need

The cost of systematic-review platforms can limit access for researchers and teams with limited funding; free plans may also restrict functionality. Prismatica was started to broaden access to a full-featured collaborative review workflow without a software subscription. Its MIT license allows researchers to use, inspect, and adapt the software, and self-hosting gives institutions control over deployment and data storage. Hosting, storage, and maintenance may still incur costs, but the software itself does not require a paid license.

Evidence reviews also involve a sequence of related decisions whose provenance and status need to remain visible as records move between stages and reviewers. Prismatica addresses this coordination need by keeping imports, screening decisions, full-text outcomes, extraction data, conflicts, and audit information within a project workspace. It supports a workflow informed by PRISMA 2020 [@page2021prisma], a guideline for reporting systematic reviews, but does not itself ensure that a review is methodologically sound or fully compliant with the guideline.

<!-- Before JOSS submission, add a specific, verifiable example of Prismatica being used in research. Planned or prospective use alone does not demonstrate research impact. -->

# AI usage disclosure

The author reports using Copilot SDK and the Codex plugin in VS Code, with GPT-6, to assist with software development and drafting this manuscript. Before submission, the author must verify the model/version details and scope of use, review and validate all AI-assisted code and text, and confirm that the software's core design decisions were made by the human author.

# Acknowledgements

[Add acknowledgements, funding information, and relevant contributions.]

# References
