import fs from "node:fs/promises";
import prettier from "prettier";

for (const file of ["lib/api-client.ts","lib/contracts.ts","lib/mock-api.ts","lib/mock-data.ts","lib/mock-feed-route.ts","tests/contracts.test.mjs","tests/mock-route.test.mjs"]) {
  const source = await fs.readFile(file, "utf8");
  const options = (await prettier.resolveConfig(file)) ?? {};
  const formatted = await prettier.format(source, { ...options, filepath: file });
  console.log("FORMATFILE " + file + " " + Buffer.from(formatted).toString("base64"));
}
