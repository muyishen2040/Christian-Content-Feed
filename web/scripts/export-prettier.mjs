import fs from "node:fs/promises";
import prettier from "prettier";

const files = [
  "app/page.tsx",
  "app/globals.css",
  "components/ui/button.tsx",
  "components/ui/field.tsx",
  "components/ui/typography.tsx",
  "components/ui/feedback-actions.tsx",
  "components/ui/testimony-card.tsx",
  "components/preview-experience.tsx",
];

for (const file of files) {
  const source = await fs.readFile(file, "utf8");
  const options = (await prettier.resolveConfig(file)) ?? {};
  const formatted = await prettier.format(source, { ...options, filepath: file });
  console.log("FORMATFILE " + file + " " + Buffer.from(formatted).toString("base64"));
}
