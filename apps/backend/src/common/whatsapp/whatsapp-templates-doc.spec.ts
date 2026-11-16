import { readFileSync } from "fs";
import { join } from "path";
import { WHATSAPP_TEMPLATES } from "./whatsapp-templates";

// docs/whatsapp-templates.md is what gets submitted to Meta; it must say
// exactly what the code sends.
describe("docs/whatsapp-templates.md", () => {
  const doc = readFileSync(join(__dirname, "../../../../../docs/whatsapp-templates.md"), "utf8");

  test.each(Object.entries(WHATSAPP_TEMPLATES))("matches the %s template in the code", (key, template) => {
    expect(doc).toContain(`### \`birr_${key}\``);
    expect(doc).toContain("```\n" + template.body + "\n```");
    expect(doc).toContain(`\`${template.setting}\``);
    expect(doc).toContain(`- **Category:** ${template.category}`);
    template.variables.forEach((v, i) => expect(doc).toContain(`| \`{{${i + 1}}}\` | ${v.name} | ${v.sample} |`));
  });
});
