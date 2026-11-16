import fs from "node:fs/promises";
import prettier from "prettier";
for (const path of ["app/globals.css","app/page.tsx","app/stories/[id]/page.tsx","lib/story-visual.ts","tests/feed-pagination.test.mjs","tests/story-visual.test.mjs","components/feed-experience.tsx","components/feed-session-provider.tsx","components/story-reading-view.tsx","components/story-visibility.tsx","components/ui/testimony-card.tsx"]) {
  const source = await fs.readFile(path, "utf8");
  const options = (await prettier.resolveConfig(path)) ?? {};
  const result = await prettier.format(source, { ...options, filepath: path });
  console.log("FORMATFILE " + path + " " + Buffer.from(result).toString("base64"));
}
