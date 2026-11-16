import fs from "node:fs/promises";
import prettier from "prettier";
for (const path of ["app/page.tsx","app/personalize/page.tsx","app/support/page.tsx","lib/mock-api.ts","components/feed-session-provider.tsx","components/onboarding-form.tsx","components/welcome-prompt.tsx"]) {
  const source = await fs.readFile(path, "utf8");
  const options = (await prettier.resolveConfig(path)) ?? {};
  const formatted = await prettier.format(source, { ...options, filepath: path });
  console.log("FORMATFILE " + path + " " + Buffer.from(formatted).toString("base64"));
}
