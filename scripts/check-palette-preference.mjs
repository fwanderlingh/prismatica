import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scryptSync } from "node:crypto";
import Module, { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "prismatica-palette-"));
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
const originalEnv = { ...process.env };

try {
  const out = path.join(temp, "out");
  const config = path.join(temp, "tsconfig.json");
  fs.writeFileSync(config, JSON.stringify({
    compilerOptions: {
      target: "ES2020", lib: ["dom", "esnext"], module: "Node16", moduleResolution: "Node16", jsx: "react-jsx", esModuleInterop: true,
      strict: true, skipLibCheck: true, noEmitOnError: true, types: ["node", "react"],
      typeRoots: [path.join(root, "node_modules/@types")], rootDir: root, outDir: out,
      paths: { "@/*": [path.join(root, "*")] }
    },
    files: ["lib/serverStore.ts", "app/api/me/route.ts", "app/layout.tsx", "components/review-sections/profile-section.tsx"].map(file => path.join(root, file))
  }));
  execFileSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "-p", config], { stdio: "inherit" });
  Module._resolveFilename = function (name, parent, ...args) {
    if (name.startsWith("@/")) name = path.join(out, name.slice(2));
    return originalResolve.call(this, name, { ...parent, paths: [...(parent?.paths ?? []), path.join(root, "node_modules")] }, ...args);
  };
  Object.assign(process.env, {
    PRISMATICA_STORAGE_MODE: "file", PRISMATICA_USERS_SYNC_POSTGRES: "false",
    PRISMATICA_OBJECT_STORAGE_PROVIDER: "local", PRISMATICA_DATA_FILE: path.join(temp, "state.json"),
    PRISMATICA_ADMIN_EMAIL: "admin@example.test", PRISMATICA_ADMIN_PASSWORD: "isolated-test-password"
  });
  const password = "isolated-reviewer-password";
  const passwordSalt = "isolated-palette-test";
  const legacyUser = {
    id: "legacy-reviewer", name: "Legacy Reviewer", email: "legacy@example.test", isAdmin: false,
    initials: "LR", organization: "Test University", title: "Reviewer", timezone: "Europe/Rome", avatarColor: "#167d7f",
    passwordSalt, passwordHash: scryptSync(password, passwordSalt, 64).toString("hex"), websiteTheme: "dark", websiteWidth: "limited"
  };
  const secondUser = { ...legacyUser, id: "second-reviewer", name: "Second Reviewer", email: "second@example.test", websiteTheme: "light", websiteWidth: "full" };
  fs.writeFileSync(process.env.PRISMATICA_DATA_FILE, JSON.stringify({
    version: 1, users: [legacyUser, secondUser], projects: [], imports: [], studies: [], reports: [], decisions: [], events: [], dedupCandidates: []
  }));
  const store = require(path.join(out, "lib/serverStore.js"));
  const reloadUser = (userId = legacyUser.id) => store.getAppStateForUser(userId).currentUser;
  const persistedUser = () => JSON.parse(fs.readFileSync(process.env.PRISMATICA_DATA_FILE, "utf8")).users.find(user => user.id === legacyUser.id);
  assert.equal(reloadUser().websitePalette, "teal", "legacy accounts keep the current Teal palette");
  assert.equal(persistedUser().websitePalette, "teal", "normalizing legacy state persists its palette default");
  assert.equal(store.updateCurrentUserForUser(legacyUser.id, { websitePalette: "coffee" }).currentUser.websitePalette, "coffee");
  assert.equal(persistedUser().websitePalette, "coffee", "Coffee is written to storage");
  assert.equal(reloadUser().websitePalette, "coffee", "Coffee survives a fresh state read");
  assert.equal(store.loginUser(legacyUser.email, password).currentUser.websitePalette, "coffee", "Coffee is restored on login");
  for (const changes of [{ name: "Updated Reviewer" }, { websiteTheme: "light" }, { websiteWidth: "full" }]) {
    assert.equal(store.updateCurrentUserForUser(legacyUser.id, changes).currentUser.websitePalette, "coffee", "other profile changes preserve Coffee when palette is omitted");
  }
  assert.equal(reloadUser().websiteTheme, "light");
  assert.equal(reloadUser().websiteWidth, "full");
  store.updateCurrentUserForUser(legacyUser.id, { websitePalette: "teal" });
  assert.equal(reloadUser().websitePalette, "teal", "switching back to Teal survives reload");
  store.updateCurrentUserForUser(legacyUser.id, { websitePalette: "coffee" });
  store.updateCurrentUserForUser(legacyUser.id, { websitePalette: "unknown-palette" });
  assert.equal(reloadUser().websitePalette, "teal", "unsupported stored preferences use the existing Teal palette");
  assert.equal(reloadUser(secondUser.id).websitePalette, "teal", "another account retains its own preference");

  // Run PostgreSQL serialization and migration functions against a query double.
  // No connection or deployment credentials are needed for these round trips.
  const queries = [];
  const client = { query: async (sql, params) => { queries.push({ sql, params }); return { rows: [], rowCount: 0 }; } };
  function scriptFunctions(file, names) {
    const code = fs.readFileSync(path.join(root, file), "utf8").replace(/^import .*$/gm, "");
    return vm.runInNewContext(code.slice(0, code.lastIndexOf("\nrun().catch")) + `\n({${names.join(",")}})`);
  }
  function insertedUser(query) {
    const columns = query.sql.match(/INSERT INTO app_users\s*\(([\s\S]*?)\)\s*VALUES/)[1].split(",").map(value => value.trim());
    return Object.fromEntries(columns.map((name, index) => [name, query.params[index]]));
  }
  const pg = scriptFunctions("scripts/postgres-state-io.mjs", ["ensureSchema", "writeUsers", "readRelationalState"]);
  await pg.ensureSchema(client);
  assert.match(queries[0].sql, /ADD COLUMN IF NOT EXISTS website_palette TEXT NOT NULL DEFAULT 'teal' CHECK \(website_palette IN \('teal', 'coffee'\)\)/, "existing PostgreSQL installations get an idempotent Teal-default migration");
  assert.doesNotMatch(queries[0].sql, /DROP CONSTRAINT.*website_palette/i, "schema setup does not replace the palette constraint on every run");
  assert.doesNotMatch(queries[0].sql, /ADD CONSTRAINT.*website_palette/i, "schema setup does not add a duplicate palette constraint");
  for (const palette of ["coffee", "teal", undefined]) {
    queries.length = 0;
    await pg.writeUsers(client, { users: [{ ...legacyUser, websitePalette: palette }] });
    const row = insertedUser(queries.find(query => query.sql.includes("INSERT INTO app_users")));
    assert.equal(row.website_palette, palette ?? "teal", "PostgreSQL writes the selected palette and defaults old accounts");
    const state = await pg.readRelationalState({ query: async sql => sql.includes("FROM app_users") ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 } });
    assert.equal(state.users[0].websitePalette, palette ?? "teal", "PostgreSQL reload restores the selected palette");
    assert.equal(state.users[0].websiteTheme, legacyUser.websiteTheme);
    assert.equal(state.users[0].websiteWidth, legacyUser.websiteWidth);
  }
  const syncPath = path.join(out, "lib/postgresUsersSync.js");
  const syncModule = new Module(syncPath);
  syncModule.filename = syncPath;
  syncModule.paths = [path.join(root, "node_modules")];
  syncModule._compile(fs.readFileSync(syncPath, "utf8") + "\nexports.paletteTestUpsert = upsertUser;", syncPath);
  const migration = scriptFunctions("scripts/migrate-users-to-postgres.mjs", ["migrateUsers"]);
  for (const [name, save] of [["user synchronization", user => syncModule.exports.paletteTestUpsert(client, user)], ["user migration", user => migration.migrateUsers(client, [user])]]) {
    for (const palette of ["coffee", "teal", undefined]) {
      queries.length = 0;
      await save({ ...legacyUser, websitePalette: palette });
      const query = queries.find(query => query.sql.includes("INSERT INTO app_users"));
      assert.equal(insertedUser(query).website_palette, palette ?? null, `${name} forwards explicit palettes and distinguishes legacy omissions`);
      assert.match(query.sql, /website_palette = COALESCE\(\$\d+, app_users.website_palette\)/, `${name} preserves the database preference when legacy input omits it`);
    }
  }

  // Exercise the real API handler; only session access and response plumbing are doubled.
  const meFile = path.join(out, "app/api/me/route.js");
  let syncCount = 0;
  Module._load = function (name, parent, ...args) {
    if (parent?.filename === meFile) {
      if (name === "@/lib/serverAuth") return { setSessionCookie: async () => {} };
      if (name === "@/lib/serverRoute") return {
        requireSessionUserId: async () => legacyUser.id,
        readJsonBody: request => request.json(), jsonOk: payload => payload,
        jsonError: error => { throw error; }
      };
      if (name === "@/lib/postgresUsersSync") return { syncUserByIdToPostgres: async () => { syncCount++; } };
    }
    return originalLoad.call(this, name, parent, ...args);
  };
  const { PATCH } = require(meFile);
  const patch = body => PATCH(new Request("http://localhost/api/me", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  assert.equal((await patch({ websitePalette: "coffee" })).currentUser.websitePalette, "coffee", "API forwards the saved palette");
  assert.equal((await patch({ organization: "Updated University" })).currentUser.websitePalette, "coffee", "account saves omit and preserve palette");
  assert.equal((await patch({ websitePalette: { invalid: true } })).currentUser.websitePalette, "coffee", "nonstring API values are ignored consistently with other preferences");
  assert.equal((await patch({ websitePalette: "teal" })).currentUser.websitePalette, "teal");
  assert.equal(syncCount, 4, "preference changes use the normal user synchronization path");
  Module._load = originalLoad;

  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { ProfileSection } = require(path.join(out, "components/review-sections/profile-section.js"));
  const noop = () => {};
  const accountForm = { ...reloadUser(), currentPassword: "", newPassword: "", websitePalette: "coffee", websiteTheme: "dark", websiteWidth: "limited" };
  let selectedPalette;
  const props = {
    currentUser: reloadUser(), accountForm, accountMessage: "", accountMessageTarget: "preferences", pendingAccountAction: null,
    handleLogout: noop, updateAccount: noop, onAccountNameChange: noop, onAccountOrganizationChange: noop,
    onAccountTitleChange: noop, onAccountCurrentPasswordChange: noop, onAccountNewPasswordChange: noop,
    onAccountPaletteChange: value => { selectedPalette = value; }, onAccountThemeChange: noop, onAccountWidthChange: noop
  };
  function nodes(node, result = []) {
    if (Array.isArray(node)) node.forEach(item => nodes(item, result));
    else if (node?.props) { result.push(node); nodes(node.props.children, result); }
    return result;
  }
  const profileTree = ProfileSection(props);
  const paletteSelect = nodes(profileTree).find(node => node.type === "select" && nodes(node).some(child => child.type === "option" && child.props.value === "coffee"));
  assert.ok(paletteSelect, "profile preferences offer a palette control");
  assert.deepEqual(nodes(paletteSelect).filter(node => node.type === "option").map(node => [node.props.value, node.props.children]), [["teal", "Teal"], ["coffee", "Coffee"]]);
  assert.equal(paletteSelect.props.value, "coffee");
  paletteSelect.props.onChange({ target: { value: "teal" } });
  assert.equal(selectedPalette, "teal", "the palette control updates the preview selection");
  const savingSelect = nodes(ProfileSection({ ...props, pendingAccountAction: "preferences" })).find(node => node.type === "select" && node.props.value === "coffee");
  assert.equal(savingSelect.props.disabled, true, "preferences cannot be changed during a save");
  const markup = renderToStaticMarkup(React.createElement(ProfileSection, props));
  assert.match(markup, /Website (?:palette|theme)/);
  assert.match(markup, /Light/);
  assert.match(markup, /Dark/);
  assert.match(markup, /System/);

  // Initial server markup uses saved appearance cookies, including before auth resolves.
  const layoutFile = path.join(out, "app/layout.js");
  let layoutCookies = new Map();
  Module._load = function (name, parent, ...args) {
    if (parent?.filename === layoutFile) {
      if (name === "next/headers") return { cookies: async () => ({ get: key => layoutCookies.has(key) ? { value: layoutCookies.get(key) } : undefined }) };
      if (name === "./globals.css" || name === "katex/dist/katex.min.css") return {};
    }
    return originalLoad.call(this, name, parent, ...args);
  };
  const { default: RootLayout } = require(layoutFile);
  for (const [cookies, palette, theme] of [
    [{}, "teal", undefined],
    [{ prismatica_palette: "coffee", prismatica_theme: "dark" }, "coffee", "dark"],
    [{ prismatica_palette: "coffee", prismatica_theme: "light" }, "coffee", "light"],
    [{ prismatica_palette: "coffee", prismatica_theme: "system" }, "coffee", undefined],
    [{ prismatica_palette: "unknown", prismatica_theme: "unknown" }, "teal", undefined]
  ]) {
    layoutCookies = new Map(Object.entries(cookies));
    const initialLayout = await RootLayout({ children: "Loading…" });
    assert.equal(initialLayout.props["data-palette"], palette, "the initial document uses the saved palette with a safe default");
    assert.equal(initialLayout.props["data-theme"], theme, "the initial document uses the saved appearance or the OS default");
  }
  Module._load = originalLoad;

  // Run the production account synchronization, preference effects, and save handler.
  const babel = require("next/dist/compiled/babel/bundle");
  const source = fs.readFileSync(path.join(root, "components/prisma-review-app.tsx"), "utf8");
  const program = babel.parser().parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] }).program;
  const findFunction = (statements, name) => statements.map(node => node.declaration ?? node).find(node => node.type === "FunctionDeclaration" && node.id?.name === name);
  const app = findFunction(program.body, "PrismaReviewApp");
  const sourceText = node => source.slice(node.start, node.end);
  const preferenceEffects = app.body.body.filter(node => node.type === "ExpressionStatement" && ["useEffect", "useLayoutEffect"].includes(node.expression?.callee?.name))
    .filter(node => sourceText(node).includes("setAccountForm(") || sourceText(node).includes("document.documentElement") || sourceText(node).includes("document.cookie"));
  const effectCode = babel.core().transformSync(`${sourceText(findFunction(app.body.body, "updateAccount"))}\nfunction renderEffects({isAuthResolved, isAuthenticated, activeView, currentUser, accountForm}) {\n${preferenceEffects.map(sourceText).join("\n")}\n}`, {
    filename: "profile-preferences.ts", configFile: false, babelrc: false, presets: [babel.presetTypescript()]
  }).code;
  const attributes = new Map([["data-palette", "coffee"], ["data-theme", "dark"]]);
  const cookieJar = new Map([["prismatica_palette", "coffee"], ["prismatica_theme", "dark"]]);
  const effectSlots = [], pendingLayoutEffects = [], pendingEffects = [], requests = [], cookieWrites = [];
  let effectCursor = 0, changed = false;
  const scheduleEffect = (queue, effect, dependencies) => {
    const index = effectCursor++, previous = effectSlots[index];
    if (!previous || dependencies.some((value, position) => !Object.is(value, previous[position]))) {
      effectSlots[index] = dependencies;
      queue.push(effect);
    }
  };
  const scope = {
    isAuthResolved: false, isAuthenticated: false, activeView: "profile", currentUser: { ...reloadUser(), id: "guest", websiteTheme: "system", websiteWidth: "limited" },
    accountForm: { ...accountForm, websitePalette: "teal" }, pendingAccountAction: null,
    document: { documentElement: { setAttribute: (name, value) => attributes.set(name, value), removeAttribute: name => attributes.delete(name) } },
    window: { location: { protocol: "https:" } },
    setAccountForm(value) { scope.accountForm = typeof value === "function" ? value(scope.accountForm) : value; changed = true; },
    setAccountMessage: noop, setAccountMessageTarget: noop, setPendingAccountAction: value => { scope.pendingAccountAction = value; },
    getErrorMessage: error => error.message,
    async apiRequest(url, options) {
      const body = JSON.parse(options.body);
      requests.push({ url, method: options.method, body });
      return await patch(body);
    },
    applyAppState: payload => { scope.currentUser = payload.currentUser; changed = true; },
    useEffect: (effect, dependencies) => scheduleEffect(pendingEffects, effect, dependencies),
    useLayoutEffect: (effect, dependencies) => scheduleEffect(pendingLayoutEffects, effect, dependencies)
  };
  Object.defineProperty(scope.document, "cookie", {
    get: () => Array.from(cookieJar, ([name, value]) => `${name}=${value}`).join("; "),
    set(value) {
      cookieWrites.push(value);
      const [pair, ...options] = value.split(";").map(part => part.trim());
      const separator = pair.indexOf("="), name = pair.slice(0, separator), content = pair.slice(separator + 1);
      if (options.some(option => /^Max-Age=0$/i.test(option))) cookieJar.delete(name);
      else cookieJar.set(name, content);
    }
  });
  vm.runInContext(effectCode, vm.createContext(scope));
  const render = () => {
    const paints = [];
    for (let pass = 0; pass < 8; pass++) {
      changed = false;
      effectCursor = 0;
      // Each render closes over its own state snapshot, as React does. State
      // updates in an earlier effect cannot change a later effect's snapshot.
      scope.renderEffects({
        isAuthResolved: scope.isAuthResolved, isAuthenticated: scope.isAuthenticated,
        activeView: scope.activeView, currentUser: scope.currentUser, accountForm: scope.accountForm
      });
      pendingLayoutEffects.splice(0).forEach(effect => effect());
      if (!changed) paints.push({ palette: attributes.get("data-palette"), theme: attributes.get("data-theme") });
      // Layout updates flush passive effects and synchronously render again
      // before paint; passive-only state updates allow the current frame to paint.
      pendingEffects.splice(0).forEach(effect => effect());
      if (!changed) return paints;
    }
    assert.fail("profile preference effects did not settle");
  };
  render();
  assert.equal(attributes.get("data-palette"), "coffee", "unresolved auth keeps the server-rendered Coffee palette during loading");
  assert.equal(attributes.get("data-theme"), "dark", "unresolved auth keeps the server-rendered dark appearance");
  assert.equal(cookieWrites.length, 0, "unresolved auth does not overwrite saved appearance cookies");
  scope.isAuthResolved = true;
  scope.isAuthenticated = true;
  const savedCoffeeUser = { ...reloadUser(), websitePalette: "coffee", websiteTheme: "dark", websiteWidth: "limited" };
  scope.currentUser = savedCoffeeUser;
  assert.deepEqual(render(), [{ palette: "coffee", theme: "dark" }], "refreshing Profile with a saved Coffee/Dark preference never paints the guest form's Teal/System defaults");
  scope.currentUser = reloadUser(secondUser.id);
  assert.deepEqual(render(), [{ palette: "teal", theme: "light" }], "switching accounts on Profile paints the new account's own appearance");
  scope.currentUser = savedCoffeeUser;
  assert.deepEqual(render(), [{ palette: "coffee", theme: "dark" }], "switching back to Coffee/Dark does not paint the previous account's form preferences");
  scope.accountForm = { ...scope.accountForm, websitePalette: "teal", websiteTheme: "light" };
  render();
  scope.currentUser = { ...scope.currentUser };
  assert.deepEqual(render(), [{ palette: "teal", theme: "light" }], "an unchanged app-state refresh preserves an unsaved appearance preview");
  assert.equal(scope.accountForm.websitePalette, "teal", "app-state refreshes do not discard unsaved palette drafts");
  scope.activeView = "dashboard";
  scope.currentUser = { ...reloadUser(), websiteTheme: "dark", websiteWidth: "limited" };
  render();
  assert.equal(attributes.get("data-palette"), "teal");
  assert.equal(attributes.get("data-theme"), "dark");
  assert.equal(attributes.get("data-width"), "limited");
  assert.equal(cookieJar.get("prismatica_palette"), "teal", "resolved auth updates the cookie to the account's saved palette");
  assert.equal(cookieJar.get("prismatica_theme"), "dark");
  for (const write of cookieWrites) {
    assert.match(write, /(?:^|;)\s*Path=\//i);
    assert.match(write, /(?:^|;)\s*Max-Age=31536000(?:;|$)/i);
    assert.match(write, /(?:^|;)\s*SameSite=Lax(?:;|$)/i);
    assert.match(write, /(?:^|;)\s*Secure(?:;|$)/i, "appearance cookies use Secure on HTTPS");
  }
  scope.activeView = "profile";
  scope.accountForm = { ...scope.accountForm, websitePalette: "coffee" };
  render();
  assert.equal(attributes.get("data-palette"), "coffee", "Coffee previews immediately on the profile page");
  assert.equal(attributes.get("data-theme"), "dark", "palette preview preserves the selected light/dark mode");
  assert.equal(attributes.get("data-width"), "limited", "palette preview preserves the selected width");
  assert.equal(cookieJar.get("prismatica_palette"), "teal", "an unsaved palette preview does not replace the reload preference");
  scope.activeView = "dashboard";
  render();
  assert.equal(attributes.get("data-palette"), "teal", "leaving the profile discards an unsaved palette preview");
  scope.activeView = "profile";
  render();
  await scope.updateAccount({ preventDefault: noop }, "preferences");
  render();
  assert.equal(requests.at(-1).body.websitePalette, "coffee", "Save Preferences submits the selected palette");
  assert.equal(reloadUser().websitePalette, "coffee");
  assert.equal(cookieJar.get("prismatica_palette"), "coffee", "saving Coffee updates the initial-render preference");
  scope.activeView = "dashboard";
  render();
  assert.equal(attributes.get("data-palette"), "coffee", "a saved palette stays active outside the profile");
  scope.accountForm = { ...scope.accountForm, websitePalette: "teal" };
  await scope.updateAccount({ preventDefault: noop }, "account");
  assert.equal(Object.hasOwn(requests.at(-1).body, "websitePalette"), false, "Save Account does not submit an unsaved palette preview");
  assert.equal(reloadUser().websitePalette, "coffee");
  scope.isAuthenticated = false;
  render();
  assert.equal(attributes.get("data-palette"), "teal", "logout clears the previous user's palette");
  assert.equal(attributes.has("data-theme"), false, "resolved guest uses the OS appearance");
  assert.equal(cookieJar.has("prismatica_palette"), false, "resolved guest expires the account's palette cookie");
  assert.equal(cookieJar.has("prismatica_theme"), false, "resolved guest expires the account's appearance cookie");
  scope.currentUser = reloadUser(secondUser.id);
  scope.isAuthenticated = true;
  render();
  assert.equal(attributes.get("data-palette"), "teal", "switching accounts applies the other user's palette");
  assert.equal(scope.accountForm.websitePalette, "teal", "switching accounts refreshes the preference form too");
  scope.currentUser = store.loginUser(legacyUser.email, password).currentUser;
  render();
  assert.equal(attributes.get("data-palette"), "coffee", "logging back in restores the account's saved palette");
  scope.activeView = "profile";
  scope.accountForm = { ...scope.accountForm, websiteTheme: "system" };
  render();
  assert.equal(attributes.has("data-theme"), false, "System theme continues to use the OS preference");
  assert.equal(attributes.get("data-palette"), "coffee");
  assert.equal(cookieJar.get("prismatica_theme"), "dark", "an unsaved System preview does not replace the saved appearance cookie");
  scope.activeView = "dashboard";
  scope.currentUser = { ...scope.currentUser, websiteTheme: "system" };
  scope.window.location.protocol = "http:";
  const previousCookieWrites = cookieWrites.length;
  render();
  assert.equal(cookieJar.get("prismatica_theme"), "system", "a saved System appearance is retained for the initial render");
  for (const write of cookieWrites.slice(previousCookieWrites)) assert.doesNotMatch(write, /(?:^|;)\s*Secure(?:;|$)/i, "appearance cookies also work on HTTP deployments");
  layoutCookies = new Map(cookieJar);
  const restoredLayout = await RootLayout({ children: "Loading…" });
  assert.equal(restoredLayout.props["data-palette"], "coffee", "a reload begins in the account's saved Coffee palette");
  assert.equal(restoredLayout.props["data-theme"], undefined, "a reload in System appearance follows the OS preference");

  const css = require("postcss").parse(fs.readFileSync(path.join(root, "app/globals.css"), "utf8"));
  function rootVariables(palette, theme, systemDark = false) {
    const values = new Map();
    css.walkRules(rule => {
      for (let ancestor = rule.parent; ancestor; ancestor = ancestor.parent) {
        if (ancestor.type === "atrule" && ancestor.name === "media" && ancestor.params.includes("prefers-color-scheme: dark") && !systemDark) return;
        if (ancestor.type === "atrule" && ancestor.name === "media" && ancestor.params.includes("prefers-color-scheme: light") && systemDark) return;
      }
      const matched = rule.selector.split(",").map(selector => selector.trim()).filter(selector => {
        if (!selector.startsWith(":root") || /[ >+~]/.test(selector)) return false;
        if (selector.includes(":not([data-theme])") && theme !== "system") return false;
        const paletteMatch = selector.match(/\[data-palette=["']?([^"'\]]+)["']?\]/);
        const themeMatch = selector.match(/\[data-theme=["']?([^"'\]]+)["']?\]/);
        return (!paletteMatch || paletteMatch[1] === palette) && (!themeMatch || themeMatch[1] === theme);
      });
      if (!matched.length) return;
      const specificity = Math.max(...matched.map(selector => (selector.match(/\[/g) ?? []).length));
      rule.nodes.filter(node => node.type === "decl" && node.prop.startsWith("--")).forEach(decl => {
        if (!values.has(decl.prop) || specificity >= values.get(decl.prop).specificity) values.set(decl.prop, { value: decl.value, specificity });
      });
    });
    return new Map(Array.from(values, ([name, result]) => [name, result.value]));
  }
  const coffeeLightBackgrounds = new Map([
    ["--bg", ["#f8f7f5", "#1a1613"]],
    ["--bg-gradient-start", ["#ffffffe0", "rgba(26, 22, 19, 0.94)"]],
    ["--bg-gradient-end", ["#f8f7f5f5", "rgba(26, 22, 19, 0.98)"]]
  ]);
  for (const [theme, systemDark] of [["light", false], ["dark", false], ["system", false], ["system", true]]) {
    const teal = rootVariables("teal", theme, systemDark), coffee = rootVariables("coffee", theme, systemDark);
    const isLight = theme === "light" || (theme === "system" && !systemDark);
    for (const name of ["--teal", "--teal-soft", "--accent-border", "--row-active-bg"]) assert.notEqual(coffee.get(name), teal.get(name), `${theme}, systemDark=${systemDark}: Coffee changes the teal accent ${name}`);
    for (const [name, [lightValue, darkValue]] of coffeeLightBackgrounds) {
      assert.equal(coffee.get(name), isLight ? lightValue : darkValue, `${theme}, systemDark=${systemDark}: Coffee uses the selected ${isLight ? "light" : "dark"} background ${name}`);
    }
    for (const name of [
      "--surface", "--surface-strong", "--surface-muted", "--surface-tint",
      "--sidebar-bg", "--sidebar-outer-bg", "--text", "--heading", "--muted", "--text-soft", "--text-strong", "--border", "--toggle-bg", "--shadow"
    ]) assert.notEqual(coffee.get(name), teal.get(name), `${theme}, systemDark=${systemDark}: Coffee uses its neutral color ${name}`);
    for (const [name, value] of teal) {
      if (/^--(?:blue|coral|amber|green|violet|toast-(?:success|warning|error))(?:-|$)/.test(name)) {
        if (name === "--blue-soft") {
          assert.equal(coffee.get(name), isLight ? "#f2efed" : "#322c29", `${theme}, systemDark=${systemDark}: Coffee keeps the selected information background tint`);
          continue;
        }
        assert.equal(coffee.get(name), value, `${theme}, systemDark=${systemDark}: semantic color ${name} stays unchanged`);
      }
    }
  }
  console.log("Palette preference checks passed: saved initial appearance and auth hydration without painted defaults, legacy defaults, API save/reload, PostgreSQL serialization and migrations, account isolation, profile preview and save behavior, light/dark/system compatibility, and preserved semantic colors with the selected Coffee information background.");
} finally {
  Module._resolveFilename = originalResolve;
  Module._load = originalLoad;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  fs.rmSync(temp, { recursive: true, force: true });
}
