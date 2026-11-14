#!/usr/bin/env node
// AIRL Firebase CLI — подключение Firebase, вход по логину и данные без ручной возни в консоли.
// Запуск: node scripts/airl-firebase.mjs <команда>   (или npm run fb -- <команда>)
// Зависимость одна: firebase-tools (npm i -D firebase-tools).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname, resolve } from "node:path";

const CWD = process.cwd();
const EMU = { auth: 9099, firestore: 8080, ui: 4000, hosting: 5000 };
const PROVIDERS = ["email", "google", "anonymous"];
const NPM_QUIET = ["--no-audit", "--no-fund", "--loglevel=error"];

// ───────────────────────── вывод ─────────────────────────
const c = (n) => (s) => (process.stdout.isTTY ? `\x1b[${n}m${s}\x1b[0m` : String(s));
const green = c(32), red = c(31), yellow = c(33), bold = c(1), dim = c(2);
const ok = (m) => console.log(`${green("✔")} ${m}`);
const warn = (m) => console.log(`${yellow("!")} ${m}`);
const bad = (m) => console.log(`${red("✘")} ${m}`);
const step = (m) => console.log(`\n${bold("▸ " + m)}`);
class Stop extends Error {}
const fail = (m, hint) => {
  bad(m);
  if (hint) console.log(`  ${dim("→")} ${hint}`);
  throw new Stop(m);
};

// ───────────────────────── аргументы ─────────────────────────
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      if (v !== undefined) out[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith("--")) out[k] = argv[++i];
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

// ───────────────────────── файлы проекта ─────────────────────────
const p = (f) => join(CWD, f);
const readJson = (f, d = null) => {
  try { return JSON.parse(readFileSync(p(f), "utf8")); } catch { return d; }
};
const writeJson = (f, o) => writeFileSync(p(f), JSON.stringify(o, null, 2) + "\n");
const pkg = () => readJson("package.json", {});
const deps = () => ({ ...(pkg().dependencies || {}), ...(pkg().devDependencies || {}) });

function currentProject(args = {}) {
  if (args.project && args.project !== true) return args.project;
  return readJson(".firebaserc", {})?.projects?.default || null;
}

function detectFramework() {
  const d = deps();
  if (d.next) return "next";
  if (d.vite || existsSync(p("vite.config.js")) || existsSync(p("vite.config.ts"))) return "vite";
  if (d["react-scripts"]) return "cra";
  return "plain";
}

function guessPublicDir(fw) {
  return { vite: "dist", cra: "build", next: "out", plain: existsSync(p("public")) ? "public" : "." }[fw];
}

// ───────────────────────── firebase-tools ─────────────────────────
function findFirebaseTools() {
  const tries = [join(CWD, "package.json")];
  const g = spawnSync("npm", ["root", "-g"], { encoding: "utf8" });
  if (g.status === 0) tries.push(join(g.stdout.trim(), "_", "package.json"));
  for (const base of tries) {
    try {
      const req = createRequire(base);
      const pj = req.resolve("firebase-tools/package.json");
      return { req, dir: dirname(pj), version: JSON.parse(readFileSync(pj, "utf8")).version };
    } catch {}
  }
  return null;
}

function firebaseBin() {
  const ft = findFirebaseTools();
  if (!ft) fail("Не нашёл firebase-tools.", "Выполните: npm i -D firebase-tools");
  return join(ft.dir, "lib", "bin", "firebase.js");
}

// Запуск команды firebase. json=true — вернуть разобранный ответ.
function fb(argsList, { json = false, inherit = false, allowFail = false } = {}) {
  const bin = firebaseBin();
  const full = [bin, ...argsList, ...(json ? ["--json"] : []), "--non-interactive"];
  if (inherit) {
    const r = spawnSync(process.execPath, full.filter((a) => a !== "--non-interactive"), { stdio: "inherit" });
    if (r.status !== 0 && !allowFail) fail(`Команда firebase ${argsList.join(" ")} завершилась с ошибкой.`);
    return r.status === 0;
  }
  const r = spawnSync(process.execPath, full, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (json) {
    let data;
    try { data = JSON.parse(r.stdout); } catch { data = null; }
    if (!data || data.status !== "success") {
      if (allowFail) return null;
      const msg = data?.error || (r.stderr || r.stdout || "").trim().split("\n").slice(-3).join(" ");
      fail(`firebase ${argsList.join(" ")}: ${msg}`);
    }
    return data.result;
  }
  if (r.status !== 0 && !allowFail) fail(`firebase ${argsList.join(" ")}: ${(r.stderr || r.stdout).trim()}`);
  return r.status === 0 ? r.stdout : null;
}

// Токен того аккаунта, под которым выполнен `firebase login` (или GOOGLE_APPLICATION_CREDENTIALS).
async function accessToken() {
  const ft = findFirebaseTools();
  if (!ft) fail("Не нашёл firebase-tools.", "Выполните: npm i -D firebase-tools");
  try {
    const auth = ft.req(join(ft.dir, "lib", "auth.js"));
    const { requireAuth } = ft.req(join(ft.dir, "lib", "requireAuth.js"));
    const apiv2 = ft.req(join(ft.dir, "lib", "apiv2.js"));
    const acct = auth.getGlobalDefaultAccount?.();
    await requireAuth(acct ? { user: acct.user, tokens: acct.tokens } : {});
    return await apiv2.getAccessToken();
  } catch (e) {
    fail("Не получилось войти в Google.", "Выполните: node scripts/airl-firebase.mjs login");
  }
}

function loggedInEmail() {
  const r = fb(["login:list"], { json: true, allowFail: true });
  const list = Array.isArray(r) ? r : [];
  return list[0]?.user?.email || null;
}

// ───────────────────────── HTTP ─────────────────────────
async function http(method, url, { token, body, project } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (project && token && token !== "owner") headers["x-goog-user-project"] = project;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const e = new Error(data?.error?.message || `${res.status} ${text.slice(0, 200)}`);
    e.status = res.status; e.data = data;
    throw e;
  }
  return data;
}

async function emulatorUp(port) {
  try { await fetch(`http://127.0.0.1:${port}/`); return true; } catch { return false; }
}

// Куда пишем: эмулятор или живой проект. Без явного выбора — не пишем никуда.
async function target(args) {
  const project = currentProject(args);
  if (!project) fail("Не знаю проект Firebase.", "Сначала: node scripts/airl-firebase.mjs setup --project <id>");
  if (args.emulator && args.prod) fail("Выберите что-то одно: --emulator или --prod.");
  if (!args.emulator && !args.prod) fail("Куда записать: на эмулятор или в живой проект?", "Добавьте --emulator (локально, безопасно) или --prod (живые данные).");
  if (args.emulator) {
    if (!(await emulatorUp(EMU.firestore)))
      fail("Эмулятор не запущен.", "В отдельном терминале: node scripts/airl-firebase.mjs emulators");
    return { project, emulator: true, token: "owner",
      fs: `http://127.0.0.1:${EMU.firestore}/v1`, idt: `http://127.0.0.1:${EMU.auth}/identitytoolkit.googleapis.com/v1` };
  }
  if (project.startsWith("demo-")) fail(`Проект ${project} — учебный, он живёт только на эмуляторе.`, "Используйте --emulator.");
  return { project, emulator: false, token: await accessToken(),
    fs: "https://firestore.googleapis.com/v1", idt: "https://identitytoolkit.googleapis.com/v1" };
}

// ───────────────────────── Firestore: JSON → документ ─────────────────────────
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") {
    if (v === "$now") return { timestampValue: new Date().toISOString() };
    if (ISO.test(v)) return { timestampValue: new Date(v).toISOString() };
    return { stringValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === "object") return { mapValue: { fields: toFields(v) } };
  return { stringValue: String(v) };
}
const toFields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, toValue(v)]));

function fromValue(v) {
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("stringValue" in v) return v.stringValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromValue);
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fromValue(x)]));
  if ("referenceValue" in v) return v.referenceValue;
  if ("geoPointValue" in v) return v.geoPointValue;
  return v;
}

// Формат файла: { "коллекция": [ {"_id": "...", ...поля} ] }  или  { "коллекция": { "id": {...поля} } }
function normalizeSeed(data) {
  if (!data || typeof data !== "object" || Array.isArray(data))
    fail("Файл должен быть объектом: { \"коллекция\": [ { ...поля } ] }.");
  const out = [];
  for (const [col, docs] of Object.entries(data)) {
    if (col.startsWith("$")) continue;
    if (col.split("/").length % 2 === 0) fail(`«${col}» — это путь к документу, а нужен путь к коллекции.`);
    const list = Array.isArray(docs)
      ? docs.map((d) => [d._id ?? d.id ?? null, d])
      : Object.entries(docs).map(([id, d]) => [id, d]);
    for (const [id, d] of list) {
      const { _id, ...fields } = d;
      out.push({ col, id: id === null ? null : String(id), fields });
    }
  }
  return out;
}

// ───────────────────────── команды ─────────────────────────
const commands = {};

commands.help = () => {
  console.log(`
${bold("AIRL Firebase CLI")} — подключает Firebase, вход по логину и данные.

${bold("Начало")}
  doctor                         проверить, что всё готово, и подсказать, что делать
  login                          войти в Google (откроется браузер)
  setup --project <id>           подключить проект: приложение, база, вход, правила
        [--create]               создать новый проект Firebase с этим ID
        [--auth email,google]    способы входа: email, google, anonymous (по умолчанию email)
        [--location eur3]        где хранить базу (по умолчанию eur3 — Европа)
  setup --demo                   учебный проект только на компьютере: без входа в Google

${bold("Каждый день")}
  emulators                      запустить Firebase на компьютере (база + вход + панель)
  seed <файл.json> --emulator|--prod      добавить данные в Firestore
  users <файл.json> --emulator|--prod     добавить пользователей (и роли, например admin)
  list <коллекция> --emulator|--prod      показать документы коллекции
  links                          ссылки на консоль: пользователи, данные, правила

${bold("Публикация")}
  domain <адрес>                 разрешить вход с вашего домена (например shop.kz)
  deploy                         собрать и выложить сайт, правила и настройки входа

Примеры файлов: node scripts/airl-firebase.mjs example
`);
};

commands.example = () => {
  if (!existsSync(p("seed"))) mkdirSync(p("seed"));
  const data = {
    services: [
      { _id: "haircut", title: "Стрижка", price: 5000, active: true },
      { _id: "color", title: "Окрашивание", price: 15000, active: true },
    ],
    settings: { main: { phone: "+7 700 000 00 00", city: "Алматы", updatedAt: "$now" } },
  };
  const users = [
    { email: "admin@test.kz", password: "test1234", name: "Администратор", role: "admin" },
    { email: "client@test.kz", password: "test1234", name: "Клиент" },
  ];
  if (!existsSync(p("seed/data.json"))) writeJson("seed/data.json", data);
  if (!existsSync(p("seed/users.json"))) writeJson("seed/users.json", users);
  ok("Созданы seed/data.json и seed/users.json — поправьте под свой продукт.");
  console.log(dim(`  "_id" — ID документа (можно не указывать), "$now" — текущее время,
  даты в формате 2026-01-31T10:00:00Z сохраняются как даты, вложенные коллекции — "users/u1/orders".`));
};

commands.doctor = async () => {
  let problems = 0;
  const need = (cond, good, badMsg, hint) => {
    if (cond) ok(good); else { problems++; bad(badMsg); if (hint) console.log(`  ${dim("→")} ${hint}`); }
  };
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 20 && major < 24) warn(`Node.js ${process.versions.node} — работает, но свежий Firebase SDK просит 24 LTS (nodejs.org)`);
  else need(major >= 24, `Node.js ${process.versions.node}`, `Node.js ${process.versions.node} — слишком старый, нужен 24 LTS`, "Скачайте с nodejs.org (версия LTS)");
  const ft = findFirebaseTools();
  need(ft, `firebase-tools ${ft?.version}`, "firebase-tools не установлен", "npm i -D firebase-tools");
  const java = spawnSync("java", ["-version"], { encoding: "utf8" });
  const jv = (java.stderr || "").match(/version "(\d+)/)?.[1];
  need(java.status === 0 && Number(jv) >= 21, `Java ${jv} — эмуляторы запустятся`,
    java.status === 0 ? `Java ${jv} — для эмуляторов нужна 21 или новее` : "Java не найдена — без неё не запустятся эмуляторы",
    "Установите Temurin 21: adoptium.net (Mac: brew install --cask temurin)");
  const project = currentProject();
  const demo = project?.startsWith("demo-");
  if (ft && !demo) {
    const email = loggedInEmail();
    need(email, `Вход в Google: ${email}`, "Не выполнен вход в Google", "node scripts/airl-firebase.mjs login");
  }
  need(project, `Проект Firebase: ${project}${demo ? " (учебный, только эмулятор)" : ""}`, "Проект Firebase не подключён", "node scripts/airl-firebase.mjs setup --project <id>  (или --demo)");
  const conf = readJson("firebase.json");
  need(conf, "firebase.json на месте", "Нет firebase.json", "node scripts/airl-firebase.mjs setup");
  if (existsSync(p("firestore.rules"))) {
    const rules = readFileSync(p("firestore.rules"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    need(!/allow\s+read\s*,\s*write\s*:\s*if\s+true|allow\s+(read|write)\s*:\s*if\s+true/.test(rules) && !/request\.time\s*</.test(rules),
      "Правила Firestore закрыты", "Правила Firestore открыты всему интернету", "Замените на правила по входу — см. firestore.rules от setup");
  } else if (conf?.firestore) { problems++; bad("Нет firestore.rules"); }
  const gi = existsSync(p(".gitignore")) ? readFileSync(p(".gitignore"), "utf8") : "";
  need(/^\.env/m.test(gi), ".env в .gitignore", ".env не в .gitignore — ключи могут уехать на GitHub", "setup добавит это сам");
  const keyFiles = readdirSync(CWD).filter((f) => /service.?account.*\.json$|-firebase-adminsdk-.*\.json$/i.test(f));
  need(keyFiles.length === 0, "Ключей сервисного аккаунта в папке нет", `В папке лежит ключ: ${keyFiles.join(", ")}`, "Удалите его — этому CLI он не нужен");
  console.log(problems ? `\n${yellow(`Нужно поправить: ${problems}`)}` : `\n${green("Всё готово.")}`);
  if (problems) process.exitCode = 1;
};

commands.login = () => {
  const remote = !process.stdout.isTTY || process.env.CODESPACES || process.env.SSH_CONNECTION || process.env.CLAUDE_CODE_REMOTE;
  console.log(`Сейчас откроется вход в Google. Войдите тем аккаунтом, на котором будет проект Firebase.
${remote ? "Компьютер удалённый: откройте ссылку в браузере, войдите и вставьте сюда код, который покажет Google.\n" : ""}`);
  fb(["login", ...(remote ? ["--no-localhost"] : [])], { inherit: true });
  const email = loggedInEmail();
  if (email) ok(`Вход выполнен: ${email}`);
};

function ensureGitignore() {
  const lines = [".env", ".env.*", "!.env.example", "*-firebase-adminsdk-*.json", "service-account*.json",
    "firebase-debug.log", "firestore-debug.log", "ui-debug.log", ".firebase/", "emulator-data/"];
  const cur = existsSync(p(".gitignore")) ? readFileSync(p(".gitignore"), "utf8") : "";
  const add = lines.filter((l) => !cur.split("\n").map((s) => s.trim()).includes(l));
  if (add.length) {
    writeFileSync(p(".gitignore"), cur + (cur && !cur.endsWith("\n") ? "\n" : "") + "\n# Firebase / секреты\n" + add.join("\n") + "\n");
    ok(".gitignore: закрыты .env, ключи и логи Firebase");
  }
}

const RULES = `rules_version = '2';
// Правила AIRL: по умолчанию всё закрыто. Открывайте ровно то, что нужно экранам.
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null; }
    function isAdmin() { return signedIn() && request.auth.token.role == 'admin'; }

    // Профиль человека: читает и меняет только он сам (и администратор).
    match /users/{userId}/{document=**} {
      allow read, write: if signedIn() && request.auth.uid == userId || isAdmin();
    }

    // Пример общедоступного справочника: читают все, меняет только администратор.
    // match /services/{id} {
    //   allow read: if true;
    //   allow write: if isAdmin();
    // }

    // Всё остальное — только администратор.
    match /{document=**} {
      allow read, write: if isAdmin();
    }
  }
}
`;

function writeFirebaseJson({ fw, providers, supportEmail, project }) {
  const conf = readJson("firebase.json", {});
  conf.firestore ??= { rules: "firestore.rules", indexes: "firestore.indexes.json" };
  if (!(fw === "next")) {
    conf.hosting ??= {
      public: guessPublicDir(fw),
      ignore: ["firebase.json", "**/.*", "**/node_modules/**"],
      ...(fw === "plain" ? {} : { rewrites: [{ source: "**", destination: "/index.html" }] }),
    };
  }
  if (providers.length && !project.startsWith("demo-")) {
    const pr = {};
    if (providers.includes("email")) pr.emailPassword = true;
    if (providers.includes("anonymous")) pr.anonymous = true;
    if (providers.includes("google")) pr.googleSignIn = { oAuthBrandDisplayName: pkg().name || project, supportEmail };
    conf.auth = { providers: pr };
  }
  conf.emulators = {
    auth: { port: EMU.auth }, firestore: { port: EMU.firestore },
    ...(conf.hosting ? { hosting: { port: EMU.hosting } } : {}),
    ui: { enabled: true, port: EMU.ui }, singleProjectMode: true,
    ...(conf.emulators || {}),
  };
  writeJson("firebase.json", conf);
  if (!existsSync(p("firestore.rules"))) writeFileSync(p("firestore.rules"), RULES);
  if (!existsSync(p("firestore.indexes.json"))) writeJson("firestore.indexes.json", { indexes: [], fieldOverrides: [] });
  ok("firebase.json, firestore.rules, firestore.indexes.json");
  if (fw === "next") warn("Next.js с сервером публикуется через App Hosting (тариф Blaze): firebase init apphosting");
}

function writeClientConfig(cfg, fw, demo) {
  const prefix = { vite: "VITE_", next: "NEXT_PUBLIC_", cra: "REACT_APP_" }[fw];
  const keys = { apiKey: "API_KEY", authDomain: "AUTH_DOMAIN", projectId: "PROJECT_ID",
    storageBucket: "STORAGE_BUCKET", messagingSenderId: "MESSAGING_SENDER_ID", appId: "APP_ID" };
  const envFile = fw === "next" || fw === "vite" ? ".env.local" : ".env";
  if (prefix) {
    const lines = Object.entries(keys).filter(([k]) => cfg[k]).map(([k, n]) => `${prefix}FIREBASE_${n}=${cfg[k]}`);
    lines.push(`${prefix}USE_EMULATORS=${demo ? "true" : "false"}`);
    const prev = existsSync(p(envFile)) ? readFileSync(p(envFile), "utf8").split("\n").filter((l) => l && !l.startsWith(`${prefix}FIREBASE_`) && !l.startsWith(`${prefix}USE_EMULATORS`)) : [];
    writeFileSync(p(envFile), [...prev, ...lines].join("\n") + "\n");
    ok(`${envFile}: настройки приложения Firebase`);
  }
  const ts = existsSync(p("tsconfig.json"));
  const dir = existsSync(p("src")) ? "src" : ".";
  const file = join(dir, ts ? "firebase.ts" : "firebase.js");
  if (existsSync(p(file))) { warn(`${file} уже есть — не трогаю.`); return; }
  const env = (n) => prefix
    ? (fw === "vite" ? `import.meta.env.${prefix}${n}` : `process.env.${prefix}${n}`)
    : JSON.stringify(cfg[Object.keys(keys).find((k) => keys[k] === n.replace("FIREBASE_", ""))] ?? "");
  const code = `// Создано airl-firebase. Настройки веб-приложения Firebase — не секрет: данные защищают правила.
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";

export const app = initializeApp({
${Object.entries(keys).filter(([k]) => cfg[k]).map(([k, n]) => `  ${k}: ${env("FIREBASE_" + n)},`).join("\n")}
});
export const auth = getAuth(app);
export const db = getFirestore(app);

// Разработка на компьютере: вход и база идут в эмулятор, живые данные не трогаем.
if (${prefix ? `${env("USE_EMULATORS")} === "true"` : demo}) {
  connectAuthEmulator(auth, "http://127.0.0.1:${EMU.auth}", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", ${EMU.firestore});
}
`;
  writeFileSync(p(file), code);
  ok(`${file}: подключение к Firebase (вход + база)`);
}

function addNpmScripts() {
  if (!existsSync(p("package.json"))) return;
  const pj = pkg();
  pj.scripts ??= {};
  const s = { fb: "node scripts/airl-firebase.mjs", "fb:emulators": "node scripts/airl-firebase.mjs emulators",
    "fb:seed": "node scripts/airl-firebase.mjs seed seed/data.json --emulator",
    "fb:users": "node scripts/airl-firebase.mjs users seed/users.json --emulator" };
  for (const [k, v] of Object.entries(s)) pj.scripts[k] ??= v;
  writeJson("package.json", pj);
  ok("package.json: npm run fb:emulators / fb:seed / fb:users");
}

// Ставим то, без чего не заработает: firebase (в приложение) и firebase-tools (этот CLI и эмуляторы).
function installDeps() {
  if (!existsSync(p("package.json"))) {
    warn("Нет package.json — библиотеки не ставлю. Создайте проект (npm create vite@latest) и запустите setup снова.");
    return;
  }
  const d = deps();
  if (!d.firebase) {
    console.log(dim("  npm i firebase …"));
    if (spawnSync("npm", ["i", "firebase", ...NPM_QUIET], { stdio: "inherit" }).status !== 0) fail("Не получилось поставить firebase.", "Проверьте интернет и выполните: npm i firebase");
    ok("Библиотека firebase установлена");
  }
  if (!d["firebase-tools"]) {
    console.log(dim("  npm i -D firebase-tools …"));
    if (spawnSync("npm", ["i", "-D", "firebase-tools", ...NPM_QUIET], { stdio: "inherit" }).status !== 0) fail("Не получилось поставить firebase-tools.", "npm i -D firebase-tools");
    ok("firebase-tools установлен в проект");
  }
}

function copySelf() {
  const self = new URL(import.meta.url).pathname;
  const dest = p("scripts/airl-firebase.mjs");
  if (resolve(self) === resolve(dest)) return;
  mkdirSync(p("scripts"), { recursive: true });
  writeFileSync(dest, readFileSync(self));
  ok("scripts/airl-firebase.mjs — CLI скопирован в проект");
}

commands.setup = async (args) => {
  const demo = !!args.demo;
  const project = demo ? (typeof args.demo === "string" ? `demo-${args.demo.replace(/^demo-/, "")}` : `demo-${(pkg().name || "airl").toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 20)}`) : currentProject(args);
  if (!project) fail("Укажите ID проекта: --project my-shop-kz", "Нет проекта? Добавьте --create, и я его создам. Или --demo, чтобы начать без Google.");
  const providers = String(args.auth && args.auth !== true ? args.auth : "email").split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = providers.filter((x) => !PROVIDERS.includes(x));
  if (unknown.length) fail(`Не знаю способ входа: ${unknown.join(", ")}`, "Есть: email, google, anonymous. Вход по телефону — в консоли, он платный.");
  const location = args.location && args.location !== true ? args.location : "eur3";
  const fw = detectFramework();

  step(`Проект ${project}${demo ? " (учебный: только на компьютере, вход в Google не нужен)" : ""}`);
  installDeps();
  copySelf();
  ensureGitignore();

  let cfg = { apiKey: "demo-api-key", authDomain: `${project}.firebaseapp.com`, projectId: project, appId: "demo-app" };
  let email = null;
  if (!demo) {
    email = loggedInEmail();
    if (!email) fail("Сначала войдите в Google.", "node scripts/airl-firebase.mjs login");
    ok(`Аккаунт: ${email}`);
    if (args.create) {
      step("Создаю проект Firebase");
      fb(["projects:create", project, "--display-name", String(args.name && args.name !== true ? args.name : project).slice(0, 30)], { json: true });
      ok(`Проект ${project} создан`);
    } else {
      const list = fb(["projects:list"], { json: true });
      if (!list.some((x) => x.projectId === project))
        fail(`У аккаунта ${email} нет проекта ${project}.`, `Создать: добавьте --create. Посмотреть свои: npx firebase projects:list`);
    }

    step("Веб-приложение Firebase");
    const apps = fb(["apps:list", "WEB", "--project", project], { json: true }) || [];
    let appId = apps[0]?.appId;
    if (!appId) {
      appId = fb(["apps:create", "WEB", `${project}-web`, "--project", project], { json: true }).appId;
      ok("Создано веб-приложение");
    } else ok(`Найдено веб-приложение ${apps[0].displayName || appId}`);
    const sdk = fb(["apps:sdkconfig", "WEB", appId, "--project", project], { json: true });
    cfg = sdk.sdkConfig || sdk;

    step("База Firestore");
    const dbs = fb(["firestore:databases:list", "--project", project], { json: true, allowFail: true }) || [];
    if (dbs.some((d) => /\/databases\/\(default\)$/.test(d.name || ""))) ok("База уже создана");
    else {
      fb(["firestore:databases:create", "(default)", "--location", location, "--project", project], { json: true });
      ok(`База создана (${location})`);
    }
  }

  step("Файлы проекта");
  writeJson(".firebaserc", { ...(readJson(".firebaserc", {})), projects: { default: project } });
  ok(".firebaserc: проект по умолчанию");
  writeFirebaseJson({ fw, providers, supportEmail: email, project });
  writeClientConfig(cfg, fw, demo);
  addNpmScripts();
  if (!existsSync(p("seed/data.json"))) commands.example();

  if (!demo) {
    step("Включаю вход и закрываю базу правилами");
    fb(["deploy", "--only", "firestore:rules,firestore:indexes,auth", "--project", project], { inherit: true });
    ok(`Вход включён: ${providers.join(", ")}`);
  }

  console.log(`\n${green(bold("Firebase подключён."))}
  Дальше:
    1. ${bold("npm run fb:emulators")}   — запустить базу и вход на компьютере (оставьте окно открытым)
    2. ${bold("npm run fb:seed")}        — добавить тестовые данные из seed/data.json
    3. ${bold("npm run fb:users")}       — добавить тестовых пользователей из seed/users.json
    4. Панель с данными и пользователями: ${bold(`http://127.0.0.1:${EMU.ui}`)}`);
};

commands.emulators = () => {
  const keep = ["--import", "./emulator-data", "--export-on-exit"];
  if (!existsSync(p("emulator-data"))) mkdirSync(p("emulator-data"));
  console.log(`Запускаю Firebase на компьютере. Панель: ${bold(`http://127.0.0.1:${EMU.ui}`)}
Данные сохранятся в emulator-data/ при остановке (Ctrl+C).\n`);
  const only = ["auth", "firestore", ...(readJson("firebase.json", {})?.hosting ? ["hosting"] : [])].join(",");
  fb(["emulators:start", "--only", only, ...keep], { inherit: true, allowFail: true });
};

commands.seed = async (args) => {
  const file = args._[1];
  if (!file || !existsSync(resolve(CWD, file))) fail("Укажите файл с данными: seed seed/data.json --emulator", "Пример файла: node scripts/airl-firebase.mjs example");
  let data;
  try { data = JSON.parse(readFileSync(resolve(CWD, file), "utf8")); } catch (e) { fail(`В ${file} ошибка JSON: ${e.message}`); }
  const docs = normalizeSeed(data);
  const t = await target(args);
  step(`Записываю ${docs.length} документ(ов) в ${t.emulator ? "эмулятор" : `живой проект ${t.project}`}`);
  const base = `${t.fs}/projects/${t.project}/databases/(default)/documents`;
  const counts = {};
  for (const d of docs) {
    const body = { fields: toFields(d.fields) };
    try {
      if (d.id) await http("PATCH", `${base}/${d.col}/${encodeURIComponent(d.id)}`, { token: t.token, body, project: t.project });
      else await http("POST", `${base}/${d.col}`, { token: t.token, body, project: t.project });
      counts[d.col] = (counts[d.col] || 0) + 1;
    } catch (e) {
      if (e.status === 404 && !t.emulator) fail("База Firestore не найдена.", "node scripts/airl-firebase.mjs setup");
      if (e.status === 403) fail(`Нет доступа к проекту ${t.project}: ${e.message}`, "Войдите аккаунтом-владельцем: node scripts/airl-firebase.mjs login");
      fail(`${d.col}/${d.id ?? "(новый)"}: ${e.message}`);
    }
  }
  for (const [col, n] of Object.entries(counts)) ok(`${col}: ${n}`);
  console.log(dim(`  Документы с "_id" перезаписываются при повторном запуске, без "_id" — добавляются заново.`));
  links(t);
};

commands.users = async (args) => {
  const file = args._[1];
  if (!file || !existsSync(resolve(CWD, file))) fail("Укажите файл: users seed/users.json --emulator", "Пример: node scripts/airl-firebase.mjs example");
  const list = JSON.parse(readFileSync(resolve(CWD, file), "utf8"));
  if (!Array.isArray(list)) fail("Файл должен быть списком: [ { \"email\": ..., \"password\": ... } ]");
  const t = await target(args);
  if (t.emulator && !(await emulatorUp(EMU.auth))) fail("Эмулятор входа не запущен.", "node scripts/airl-firebase.mjs emulators");
  step(`Добавляю ${list.length} пользовател(я/ей) в ${t.emulator ? "эмулятор" : `живой проект ${t.project}`}`);
  const base = `${t.idt}/projects/${t.project}`;
  for (const u of list) {
    if (!u.email || !u.password) fail(`У пользователя нет email или password: ${JSON.stringify(u)}`);
    if (String(u.password).length < 6) fail(`${u.email}: пароль короче 6 символов — Firebase такой не примет.`);
    let uid;
    try {
      const r = await http("POST", `${base}/accounts`, { token: t.token, project: t.project,
        body: { email: u.email, password: String(u.password), displayName: u.name, emailVerified: true } });
      uid = r.localId;
    } catch (e) {
      if (!/EMAIL_EXISTS/.test(e.message)) fail(`${u.email}: ${e.message}`);
      const r = await http("POST", `${base}/accounts:lookup`, { token: t.token, project: t.project, body: { email: [u.email] } });
      uid = r.users?.[0]?.localId;
      await http("POST", `${base}/accounts:update`, { token: t.token, project: t.project, body: { localId: uid, password: String(u.password), displayName: u.name } });
    }
    if (u.role !== undefined || u.claims) {
      const claims = { ...(u.claims || {}), ...(u.role !== undefined ? { role: u.role } : {}) };
      await http("POST", `${base}/accounts:update`, { token: t.token, project: t.project, body: { localId: uid, customAttributes: JSON.stringify(claims) } });
    }
    const profile = { email: u.email, name: u.name ?? null, role: u.role ?? "user", createdAt: new Date().toISOString() };
    await http("PATCH", `${t.fs}/projects/${t.project}/databases/(default)/documents/users/${uid}`, { token: t.token, project: t.project, body: { fields: toFields(profile) } });
    ok(`${u.email}${u.role ? ` (${u.role})` : ""} — uid ${uid}`);
  }
  console.log(dim("  Каждому создан профиль users/<uid>. Роль доступна в правилах как request.auth.token.role."));
  links(t);
};

commands.list = async (args) => {
  const col = args._[1];
  if (!col) fail("Какую коллекцию показать? list services --emulator");
  const t = await target(args);
  const r = await http("GET", `${t.fs}/projects/${t.project}/databases/(default)/documents/${col}?pageSize=${Number(args.limit) || 20}`, { token: t.token, project: t.project });
  const docs = r.documents || [];
  if (!docs.length) { warn(`В «${col}» пусто.`); return; }
  for (const d of docs) {
    const id = d.name.split("/").pop();
    console.log(`${bold(id)}  ${JSON.stringify(fromValue({ mapValue: { fields: d.fields || {} } }))}`);
  }
};

function links(t) {
  if (t?.emulator) console.log(`\n  Посмотреть: ${bold(`http://127.0.0.1:${EMU.ui}/firestore`)} · пользователи: ${bold(`http://127.0.0.1:${EMU.ui}/auth`)}`);
  else if (t) console.log(`\n  Посмотреть: ${bold(`https://console.firebase.google.com/project/${t.project}/firestore/data`)}`);
}

commands.links = (args) => {
  const project = currentProject(args);
  if (!project) fail("Проект не подключён.", "node scripts/airl-firebase.mjs setup --project <id>");
  const b = `https://console.firebase.google.com/project/${project}`;
  console.log(`${bold("На компьютере (эмулятор)")}  http://127.0.0.1:${EMU.ui}
${bold("Данные")}           ${b}/firestore/data
${bold("Пользователи")}     ${b}/authentication/users
${bold("Способы входа")}    ${b}/authentication/providers
${bold("Правила базы")}     ${b}/firestore/rules
${bold("Сайт")}             ${b}/hosting/sites
${bold("Расходы")}          ${b}/usage/details`);
};

commands.domain = async (args) => {
  const host = args._[1]?.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!host) fail("Укажите домен: domain shop.kz");
  const project = currentProject(args);
  if (!project || project.startsWith("demo-")) fail("Нужен настоящий проект Firebase.");
  const token = await accessToken();
  const url = `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`;
  const cfg = await http("GET", url, { token, project });
  const domains = new Set(cfg.authorizedDomains || []);
  if (domains.has(host)) { ok(`${host} уже разрешён для входа.`); return; }
  domains.add(host);
  await http("PATCH", `${url}?updateMask=authorizedDomains`, { token, project, body: { authorizedDomains: [...domains] } });
  ok(`Вход с ${host} разрешён. Все домены: ${[...domains].join(", ")}`);
};

commands.deploy = (args) => {
  const project = currentProject(args);
  if (!project || project.startsWith("demo-")) fail("Учебный проект не публикуется.", "Подключите настоящий: setup --project <id>");
  const conf = readJson("firebase.json", {});
  const env = [".env.local", ".env"].map((f) => existsSync(p(f)) ? readFileSync(p(f), "utf8") : "").join("\n");
  if (/USE_EMULATORS=true/.test(env)) fail("В .env включены эмуляторы — сайт в интернете не увидит живую базу.", "Поставьте ..._USE_EMULATORS=false");
  if (pkg().scripts?.build) {
    step("Сборка");
    const r = spawnSync("npm", ["run", "build"], { stdio: "inherit" });
    if (r.status !== 0) fail("Сборка не прошла — публиковать нечего.");
  }
  const only = ["firestore", conf.auth && "auth", conf.hosting && "hosting", conf.storage && "storage", conf.functions && "functions"].filter(Boolean).join(",");
  step(`Публикую: ${only}`);
  fb(["deploy", "--only", only, "--project", project], { inherit: true });
  if (conf.hosting) ok(`Сайт: https://${project}.web.app`);
};

// ───────────────────────── запуск ─────────────────────────
const args = parseArgs(process.argv.slice(2));
const cmd = args._[0] || "help";
if (!commands[cmd]) { bad(`Нет такой команды: ${cmd}`); commands.help(); process.exit(1); }
try {
  await commands[cmd](args);
} catch (e) {
  if (!(e instanceof Stop)) { bad(e.message); if (process.env.DEBUG) console.error(e); }
  process.exitCode = 1;
}
