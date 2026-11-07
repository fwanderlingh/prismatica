import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module, { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "prismatica-feedback-"));
const originalResolve = Module._resolveFilename;
let passed = 0;

async function check(name, run) {
  try {
    await run();
    passed++;
  } catch (error) {
    throw new Error(name, { cause: error });
  }
}

try {
  const config = path.join(temp, "tsconfig.json");
  fs.writeFileSync(config, JSON.stringify({
    compilerOptions: {
      target: "ES2020", module: "Node16", moduleResolution: "Node16", jsx: "react-jsx", esModuleInterop: true,
      noEmitOnError: true, strict: true, skipLibCheck: true, types: ["node", "react"],
      typeRoots: [path.join(root, "node_modules/@types")], rootDir: root, outDir: temp,
      paths: { "@/*": [path.join(root, "*")] }
    },
    files: [path.join(root, "components/prisma-review-ui.tsx")]
  }));
  execFileSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "-p", config], { stdio: "inherit" });
  Module._resolveFilename = function(name, parent, ...args) {
    if (name.startsWith("@/")) name = path.join(temp, name.slice(2));
    return originalResolve.call(this, name, { ...parent, paths: [...(parent?.paths ?? []), path.join(root, "node_modules")] }, ...args);
  };
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { FeedbackNotice } = require(path.join(temp, "components/prisma-review-ui.js"));
  const render = feedback => renderToStaticMarkup(React.createElement(FeedbackNotice, { feedback }));

  await check("empty feedback does not create a notification", () => assert.equal(render(null), ""));
  for (const [status, tone, role, icon] of [
    ["pending", "muted", "status", /class="inlineSpinner"/],
    ["success", "ok", "status", /lucide-check\b/],
    ["warning", "warning", "status", /lucide-(?:alert-triangle|triangle-alert)\b/],
    ["error", "blocked", "alert", /lucide-(?:alert-triangle|triangle-alert)\b/]
  ]) {
    await check(`${status} has explicit styling, icon, and announcement semantics`, () => {
      const message = status === "error" ? "Updated records could not be reviewed." : "Feedback text";
      const markup = render({ status, message });
      assert.match(markup, new RegExp(`class="validationItem ${tone}"`));
      assert.match(markup, new RegExp(`role="${role}"`));
      assert.match(markup, /aria-atomic="true"/);
      assert.match(markup, icon);
      assert.ok(markup.includes(message));
      assert.match(markup, /aria-hidden="true"/, "the visual state indicator is decorative");
      if (status !== "success") assert.doesNotMatch(markup, /lucide-check\b|validationItem ok/);
    });
  }

  // Execute production handlers instead of reproducing their state transitions.
  const parser = require("next/dist/compiled/babel/parser");
  const babel = require("next/dist/compiled/babel/core");
  const source = fs.readFileSync(path.join(root, "components/prisma-review-app.tsx"), "utf8");
  const parse = code => parser.parse(code, { sourceType: "module", plugins: ["typescript", "jsx"] });
  const declarations = new Map(), appProps = new Map();
  function visit(node, action) {
    if (!node || typeof node !== "object") return;
    action(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(child => visit(child, action));
      else if (value && typeof value === "object") visit(value, action);
    }
  }
  visit(parse(source), node => {
    if (node.type === "FunctionDeclaration" && node.id?.name) declarations.set(node.id.name, source.slice(node.start, node.end));
    if (node.type === "JSXOpeningElement") appProps.set(node.name?.name, node.attributes);
  });
  function handler(name, scope) {
    assert.ok(declarations.has(name), `${name} exists in the application`);
    const code = babel.transformSync(`${declarations.get(name)}\nreturn ${name};`, {
      filename: "handler.ts", babelrc: false, configFile: false,
      parserOpts: { allowReturnOutsideFunction: true },
      presets: [require("next/dist/compiled/babel/preset-typescript")]
    }).code;
    return new Function(...Object.keys(scope), code)(...Object.values(scope));
  }
  await check("team and import sections receive and render explicit feedback", () => {
    for (const [component, file, prop] of [
      ["SettingsSection", "settings-section", "teamFeedback"],
      ["ImportEditorSection", "import-editor-section", "importDetailFeedback"]
    ]) {
      const attribute = appProps.get(component)?.find(item => item.name?.name === prop);
      const expression = attribute?.value?.expression;
      assert.ok(expression, `${component} receives its feedback state`);
      const selectFeedback = new Function(prop, "selectedProject", "batch", `return ${source.slice(expression.start, expression.end)};`);
      const feedback = { status: "success", message: "Saved", projectId: "review-one", importId: "batch-one" };
      assert.equal(selectFeedback(feedback, { id: "review-one" }, { id: "batch-one" }), feedback);
      assert.equal(selectFeedback(feedback, { id: "another-review" }, { id: "batch-one" }), null,
        `${component} hides feedback left over from another project`);
      if (component === "ImportEditorSection") {
        assert.equal(selectFeedback(feedback, { id: "review-one" }, { id: "another-batch" }), null,
          "import editor hides feedback left over from another batch");
      }
      const section = fs.readFileSync(path.join(root, `components/review-sections/${file}.tsx`), "utf8");
      let noticeFeedback;
      visit(parse(section), node => {
        if (node.type === "JSXOpeningElement" && node.name?.name === "FeedbackNotice") {
          noticeFeedback = node.attributes.find(item => item.name?.name === "feedback")?.value?.expression?.name;
        }
      });
      assert.equal(noticeFeedback, prop, `${component} renders the shared notification`);
    }
  });

  const selectedProject = { id: "review-one", title: "Example review", memberIds: ["existing-user"] };
  const event = { preventDefault() {} };
  function deferred() {
    let resolve, reject;
    const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
    return { promise, resolve, reject };
  }
  function inviteHarness(inviteForm = { name: "New Reviewer", email: "new@example.org", title: "Reviewer" }) {
    const request = deferred(), feedback = [], pending = [], calls = [], applied = [], forms = [];
    const invite = handler("inviteUserToProject", {
      selectedProject, inviteForm, users: [{ id: "existing-user", name: "Existing Reviewer", email: "existing@example.org" }],
      setTeamFeedback: value => feedback.push(value), setIsInvitingProjectUser: value => pending.push(value),
      apiRequest: (...args) => { calls.push(args); return request.promise; },
      applyAppState: value => applied.push(value), setInviteForm: value => forms.push(value),
      getErrorMessage: error => error.message
    });
    return { invite, request, feedback, pending, calls, applied, forms };
  }
  for (const inviteForm of [
    { name: " ", email: "new@example.org", title: "Reviewer" },
    { name: "Existing Reviewer", email: " EXISTING@example.org ", title: "Reviewer" }
  ]) {
    await check("invitation validation warns without sending a request", async () => {
      const test = inviteHarness(inviteForm);
      await test.invite(event);
      assert.equal(test.feedback.at(-1)?.status, "warning");
      assert.equal(test.calls.length, 0);
      assert.deepEqual(test.pending, []);
    });
  }
  for (const fails of [false, true]) {
    await check(`invitation transitions from pending to ${fails ? "error" : "success"}`, async () => {
      const test = inviteHarness(), running = test.invite(event);
      assert.equal(test.feedback.at(-1)?.status, "pending");
      assert.deepEqual(test.pending, [true]);
      assert.equal(test.calls[0]?.[0], "/api/projects/review-one/invite");
      const message = fails ? "Updated invitation could not be reviewed." : "Invitation sent.";
      if (fails) test.request.reject(new Error(message));
      else test.request.resolve({ message });
      await running;
      assert.equal(test.feedback.at(-1)?.status, fails ? "error" : "success");
      assert.equal(test.feedback.at(-1)?.message, message);
      assert.deepEqual(test.pending, [true, false]);
      assert.equal(test.applied.length, fails ? 0 : 1);
      assert.equal(test.forms.length, fails ? 0 : 1, "a failed invitation keeps the form values");
    });
  }
  for (const fails of [false, true]) {
    await check(`import review stays pending until ${fails ? "failure" : "success"}`, async () => {
      const request = deferred(), feedback = [], pending = [], calls = [];
      const review = handler("reviewImportWarnings", {
        selectedProject, importDetailForm: { sourceName: "Example", filename: "citations.ris" },
        setIsReviewingImportWarnings: value => pending.push(value), setImportDetailFeedback: value => feedback.push(value),
        apiRequest: (...args) => { calls.push(args); return request.promise; },
        applyAppState() {}, getErrorMessage: error => error.message
      });
      const running = review("batch-one");
      assert.deepEqual(feedback.at(-1), { status: "pending", message: "Saving review..." });
      assert.match(render(feedback.at(-1)), /validationItem muted/);
      assert.deepEqual(pending, [true]);
      assert.equal(calls[0]?.[0], "/api/projects/review-one/imports/batch-one/review");
      const message = "Updated citation could not be reviewed.";
      if (fails) request.reject(new Error(message));
      else request.resolve({});
      await running;
      assert.deepEqual(feedback.at(-1), fails
        ? { status: "error", message }
        : { status: "success", message: "Parser warnings reviewed." });
      assert.deepEqual(pending, [true, false]);
      assert.match(render(feedback.at(-1)), fails ? /validationItem blocked/ : /validationItem ok/);
    });
  }

  console.log(`Feedback states: ${passed} regression groups passed.`);
} finally {
  Module._resolveFilename = originalResolve;
  fs.rmSync(temp, { recursive: true, force: true });
}
