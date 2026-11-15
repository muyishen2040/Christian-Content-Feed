import fs from "node:fs/promises";
import prettier from "prettier";
for (const file of ["app/page.tsx","app/globals.css","app/stories/[id]/page.tsx","components/ui/testimony-card.tsx"]) {
  const source = await fs.readFile(file, "utf8");
  const options = (await prettier.resolveConfig(file)) ?? {};
  const formatted = await prettier.format(source, { ...options, filepath: file });
  console.log("FORMATFILE " + file + " " + Buffer.from(formatted).toString("base64"));
}
