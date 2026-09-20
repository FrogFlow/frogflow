/**
 * Опись знания, добытого на живых клиентах.
 *
 * Собирает docs/v2/inherited-knowledge.md из двух источников: имён проверок
 * (каждое — требование, которое кто-то нарушил в проде) и правок вида fix
 * (каждая — поломка, которую увидел покупатель или продавец).
 *
 * Нужно это ради переписывания платформы: архитектуру можно придумать заново,
 * а вот что Zernio с sortOrder asc отдаёт самые старые сто сообщений — нельзя.
 * Такое знание не выводится, оно только добывается поломкой, и терять его при
 * переезде на v2 дороже всего остального вместе взятого.
 *
 * Запуск: npm run knowledge
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const OUT = "docs/v2/inherited-knowledge.md";
/** Подписи, которые к сути правки отношения не имеют. */
const TRAILERS = ["Co-Authored-By:", "Claude-Session:", "🤖"];

function testFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) testFiles(path, acc);
    else if (name.endsWith(".test.ts")) acc.push(path);
  }
  return acc;
}

function fixCommits() {
  // \x1f разделяет поля, \x1e — записи: в теле коммита бывают и переводы
  // строк, и всё остальное, поэтому по ним делить нельзя.
  const log = execFileSync("git", ["log", "--pretty=format:%h\x1f%s\x1f%b\x1e"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return log
    .split("\x1e")
    .filter((c) => c.trim())
    .map((c) => c.trim().split("\x1f"))
    .filter(([, subject]) => subject?.startsWith("fix"))
    .map(([sha, subject, body = ""]) => ({
      sha,
      subject,
      body: body
        .trim()
        .split("\n")
        .filter((line) => !TRAILERS.some((t) => line.startsWith(t)))
        .join("\n")
        .trim(),
    }));
}

/** Имена проверок и вводный комментарий файла — объяснение, зачем они есть. */
function readSpec(path) {
  const src = readFileSync(path, "utf8");
  const names = [...src.matchAll(/^\s*it\(\s*(["'])(.+?)\1/gm)].map((m) => m[2]);
  const head = src.match(/\/\*\*(.*?)\*\//s);
  const why = head
    ? head[1]
        .split("\n")
        .map((line) =>
          line
            .trim()
            .replace(/^\*\s?/, "")
            .trim(),
        )
        .join(" ")
        .trim()
    : "";
  return { path, names, why };
}

const fixes = fixCommits();
const specs = testFiles("src")
  .concat(testFiles("tests"))
  .sort()
  .map(readSpec)
  .filter((s) => s.names.length);
const checks = specs.reduce((n, s) => n + s.names.length, 0);

const out = [];
out.push(
  "# Что платформа уже знает\n",
  "\nЭто опись знания, добытого на живых клиентах. Она собрана механически — из",
  "\nимён проверок и из истории правок — и существует ради одного: при переписывании",
  "\nплатформы ни одна строка отсюда не должна быть потеряна.\n",
  "\nКаждое имя проверки ниже — требование, которое кто-то когда-то нарушил в проде.",
  "\nКаждая правка — поломка, которую увидел покупатель или продавец. Переписанная",
  "\nплатформа готова не тогда, когда она работает, а тогда, когда проходит всё,",
  "\nчто перечислено здесь.\n",
  "\nФайл собирается заново командой `npm run knowledge` — руками его не правят.\n\n",
);

out.push(`## Поломки, которые уже случились (${fixes.length})\n\n`);
out.push(
  "Правки, сделанные по факту сбоя у клиента. В теле каждой записан симптом и\n",
  "причина — это самое дорогое, что есть в репозитории.\n\n",
);
for (const { sha, subject, body } of fixes) {
  out.push(`### ${subject}\n\n\`${sha}\`\n\n`);
  if (body) out.push(`${body}\n\n`);
}

out.push(`## Требования к поведению (${checks} проверок в ${specs.length} файлах)\n\n`);
out.push(
  "Имя каждой проверки — формулировка требования на русском. Это и есть\n",
  "техническое задание на переписанную платформу.\n\n",
);
for (const { path, names, why } of specs) {
  out.push(`### \`${path}\`\n\n`);
  if (why) out.push(`> ${why}\n\n`);
  for (const name of names) out.push(`- ${name}\n`);
  out.push("\n");
}

mkdirSync("docs/v2", { recursive: true });
writeFileSync(OUT, out.join(""), "utf8");
console.log(`${OUT}: правок ${fixes.length}, проверок ${checks} в ${specs.length} файлах`);
