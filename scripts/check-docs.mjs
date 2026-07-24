import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docsDirectory = path.join(root, "docs");
const numberedDocs = readdirSync(docsDirectory)
  .filter((name) => /^\d{2}-.*\.md$/.test(name))
  .sort();
const errors = [];
const requiredMetadata = ["文档角色", "权威性", "何时阅读", "可跳过", "相关代码"];
const docsIndex = readFileSync(path.join(docsDirectory, "README.md"), "utf8");
const metadataDocs = ["README.md", ...numberedDocs];

for (const name of metadataDocs) {
  const content = readFileSync(path.join(docsDirectory, name), "utf8");
  for (const field of requiredMetadata) {
    if (!content.includes(`> **${field}**`)) {
      errors.push(`${name}: missing metadata field ${field}`);
    }
  }
  if (name !== "README.md" && !docsIndex.includes(`./${name}`)) {
    errors.push(`${name}: not linked from docs/README.md`);
  }
}

const markdownFiles = [
  "AGENTS.md",
  "CONTRIBUTING.md",
  "README.md",
  ".github/pull_request_template.md",
  ...readdirSync(docsDirectory)
    .filter((name) => name.endsWith(".md"))
    .map((name) => path.join("docs", name)),
];
const markdownLink = /\[[^\]]*\]\(([^)]+)\)/g;

for (const relativeFile of markdownFiles) {
  const absoluteFile = path.join(root, relativeFile);
  const content = readFileSync(absoluteFile, "utf8");
  for (const match of content.matchAll(markdownLink)) {
    let target = match[1]?.trim() ?? "";
    if (!target || /^(https?:|mailto:)/.test(target)) {
      continue;
    }
    if (target.startsWith("<") && target.endsWith(">")) {
      target = target.slice(1, -1);
    }
    target = target.split("#", 1)[0] ?? "";
    if (!target) {
      continue;
    }
    const resolved = path.resolve(path.dirname(absoluteFile), decodeURIComponent(target));
    if (!existsSync(resolved)) {
      errors.push(`${relativeFile}: broken local link ${target}`);
    }
  }
}

if (!docsIndex.includes("../AGENTS.md") || !docsIndex.includes("./00-context-guide.md")) {
  errors.push("docs/README.md: missing AGENTS or context-guide entry point");
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  `Documentation checks passed (${metadataDocs.length} indexed docs, ${markdownFiles.length} Markdown files).`,
);
