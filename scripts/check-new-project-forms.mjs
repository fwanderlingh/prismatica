import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module, { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "prismatica-new-project-forms-"));
const originalResolve = Module._resolveFilename;
let passed = 0;
function check(name, run) {
  try { run(); passed++; }
  catch (error) { throw new Error(name, { cause: error }); }
}

try {
  const config = path.join(temp, "tsconfig.json");
  fs.writeFileSync(config, JSON.stringify({ compilerOptions: {
    target: "ES2020", module: "Node16", moduleResolution: "Node16", jsx: "react-jsx", esModuleInterop: true,
    noEmitOnError: true, strict: true, skipLibCheck: true, types: ["node", "react"],
    typeRoots: [path.join(root, "node_modules/@types")], rootDir: root, outDir: temp,
    paths: { "@/*": [path.join(root, "*")] }
  }, files: [path.join(root, "components/review-sections/new-project-section.tsx")] }));
  execFileSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "-p", config], { stdio: "inherit" });
  Module._resolveFilename = function(name, parent, ...args) {
    if (name.startsWith("@/")) name = path.join(temp, name.slice(2));
    return originalResolve.call(this, name, { ...parent, paths: [...(parent?.paths ?? []), path.join(root, "node_modules")] }, ...args);
  };
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { NewProjectSection } = require(path.join(temp, "components/review-sections/new-project-section.js"));
  const noop = () => {};
  const user = { id: "owner", name: "Owner", email: "owner@example.org", initials: "OW", title: "Reviewer", avatarColor: "#fff" };
  const props = {
    currentUser: user, users: [user], canCreate: true, isCreatingProject: false,
    newProjectForm: {
      title: "Valid review title", organization: "Methods Unit", protocolId: "PROTOCOL-1",
      dueDate: "30-09-2027", description: "Review question", searchStrategies: "Search strategy",
      blindMode: true, abstractRequiredVotes: 2, fullTextRequiredVotes: 2,
      extractionRequiredVotes: 2, maybePolicy: "advance_to_full_text", memberIds: [user.id]
    },
    creationStatus: "Ready to create", creationSummary: "Ready", teamMessage: "", memberSearch: "Reviewer",
    memberSearchResults: [], inviteDraft: { name: "New Reviewer", email: "new@example.org", title: "Reviewer" },
    canShowInviteForm: true, queuedInvites: [],
    ...Object.fromEntries([
      "Back", "TitleChange", "OrganizationChange", "ProtocolIdChange", "DueDateChange", "DescriptionChange",
      "SearchStrategiesChange", "BlindModeChange", "AbstractVotesChange", "FullTextVotesChange", "ExtractionVotesChange",
      "MaybePolicyChange", "MemberSearchChange", "AddMember", "RemoveMember", "InviteNameChange", "InviteEmailChange",
      "InviteTitleChange", "RemoveQueuedInvite"
    ].map(name => [`on${name}`, noop]))
  };
  const label = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node)
    : Array.isArray(node) ? node.map(label).join("") : label(node.props?.children);
  function fixture(overrides = {}) {
    const calls = { project: 0, invite: 0, prevented: 0 };
    let tree;
    function Probe() {
      tree = NewProjectSection({ ...props,
        onSubmit: event => { event.preventDefault(); calls.project++; },
        onQueueInvite: () => { calls.invite++; }, ...overrides });
      return null;
    }
    // SSR provides React's hook dispatcher, including the production useId call.
    renderToStaticMarkup(React.createElement(Probe));
    const entries = [];
    function visit(node, ancestors = []) {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(child => visit(child, ancestors));
      entries.push({ node, ancestors });
      visit(node.props?.children, [...ancestors, node]);
    }
    visit(tree);
    const forms = entries.filter(({ node }) => node.type === "form");
    function owner(entry) {
      return entry.node.props.form !== undefined
        ? forms.find(({ node }) => node.props.id === entry.node.props.form)?.node
        : entry.ancestors.findLast(node => node.type === "form");
    }
    function submit(entry) {
      const form = owner(entry);
      assert.ok(form, "the control has a form owner");
      const event = { preventDefault() { calls.prevented++; } };
      const ancestorForms = entries.find(item => item.node === form).ancestors.filter(node => node.type === "form").reverse();
      [form, ...ancestorForms].forEach(node => node.props.onSubmit?.(event));
    }
    return { entries, forms, owner, submit, calls };
  }
  const test = fixture();
  const project = test.forms.find(({ node }) => node.props.id)?.node;
  const invitation = test.forms.find(({ node }) => node.props.className === "inviteForm")?.node;
  check("review creation and invitations have independent forms", () => {
    assert.equal(test.forms.length, 2);
    assert.ok(project && invitation && project !== invitation);
    const ids = test.forms.map(({ node }) => node.props.id).filter(Boolean);
    assert.equal(new Set(ids).size, ids.length, "form IDs are unique");
    assert.equal(project.props["aria-label"], "Create review project");
    assert.equal(invitation.props["aria-label"], "Queue reviewer invitation");
    assert.ok(test.forms.every(({ ancestors }) => !ancestors.some(node => node.type === "form")), "forms cannot be nested");
  });
  const queue = test.entries.find(({ node }) => node.type === "button" && label(node).includes("Queue Invitation"));
  const invitationInputs = test.entries.filter(entry => entry.node.type === "input" && test.owner(entry) === invitation);
  assert.equal(invitationInputs.length, 3);
  for (const entry of [queue, ...invitationInputs]) {
    check(`invitation ${entry === queue ? "button" : entry.node.props.placeholder + " Enter"} only queues once`, () => {
      test.calls.project = test.calls.invite = test.calls.prevented = 0;
      assert.equal(queue.node.props.type, "submit", "invitation supports button and implicit Enter submission");
      test.submit(entry);
      assert.deepEqual(test.calls, { project: 0, invite: 1, prevented: 1 });
    });
  }
  check("both Create Review actions submit only the review form", () => {
    const buttons = test.entries.filter(({ node }) => node.type === "button" && label(node) === "Create Review");
    assert.equal(buttons.length, 2);
    for (const button of buttons) {
      test.calls.project = test.calls.invite = test.calls.prevented = 0;
      assert.equal(test.owner(button), project);
      assert.equal(button.node.props.type, "submit");
      assert.equal(button.node.props.disabled, false);
      test.submit(button);
      assert.deepEqual(test.calls, { project: 1, invite: 0, prevented: 1 });
    }
  });
  check("review details and screening policy retain review ownership and native validation", () => {
    const projectControls = test.entries.filter(entry => ["input", "select", "textarea"].includes(entry.node.type) && test.owner(entry) === project);
    assert.equal(projectControls.length, 11, "six detail controls and five policy controls belong to review creation");
    const dueDate = projectControls.find(({ node }) => node.props.placeholder === "30-09-2026").node;
    assert.equal(dueDate.props.pattern, "[0-9]{2}-[0-9]{2}-[0-9]{4}");
    assert.equal(dueDate.props.inputMode, "numeric");
    assert.deepEqual(projectControls.filter(({ node }) => node.props.type === "number").map(({ node }) => [node.props.min, node.props.max]), [[1, 4], [2, 4], [1, 4]]);
    assert.equal(projectControls.filter(({ node }) => node.props.type === "checkbox").length, 1);
    assert.equal(projectControls.filter(({ node }) => node.type === "select").length, 1);
    assert.ok(test.forms.every(({ node }) => !node.props.noValidate));
    assert.ok(test.entries.every(({ node }) => !node.props?.formNoValidate));
  });
  check("member search does not submit a form", () => {
    assert.equal(test.owner(test.entries.find(({ node }) => node.props?.placeholder === "Name or email")), undefined);
  });
  check("hiding invitation entry preserves review creation", () => {
    const hidden = fixture({ canShowInviteForm: false });
    assert.equal(hidden.forms.length, 1);
    assert.ok(!hidden.entries.some(({ node }) => node.type === "button" && label(node).includes("Queue Invitation")));
    const create = hidden.entries.find(({ node }) => node.type === "button" && label(node) === "Create Review");
    hidden.submit(create);
    assert.deepEqual(hidden.calls, { project: 1, invite: 0, prevented: 1 });
  });
  console.log(`New project forms: ${passed} regression groups passed.`);
} finally {
  Module._resolveFilename = originalResolve;
  fs.rmSync(temp, { recursive: true, force: true });
}
