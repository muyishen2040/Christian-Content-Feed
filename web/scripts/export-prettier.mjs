import fs from "node:fs/promises";
import prettier from "prettier";
for (const file of ["components/feed-experience.tsx", "components/story-reading-view.tsx"]) {
  const source = await fs.readFile(file, "utf8");
  const options = (await prettier.resolveConfig(file)) ?? {};
  const output = await prettier.format(source, { ...options, filepath: file });
  console.log("FORMATFILE " + file + " " + Buffer.from(output).toString("base64"));
}
