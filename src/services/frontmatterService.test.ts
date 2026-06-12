import { describe, expect, it } from "vitest";
import { parseFrontmatter, stringifyFrontmatter, updateFrontmatter } from "./frontmatterService";

describe("frontmatterService", () => {
  it("parses frontmatter data and keeps the markdown body", () => {
    const parsed = parseFrontmatter(`---
date: 2026-06-07
mood: calm
tags: [工作, 家庭]
weather: cloudy
energy: normal
favorite: false
score: 8
---

# 今天

正文`);

    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.data).toEqual({
      date: "2026-06-07",
      mood: "calm",
      tags: ["工作", "家庭"],
      weather: "cloudy",
      energy: "normal",
      favorite: false,
      score: 8,
    });
    expect(parsed.body).toBe("# 今天\n\n正文");
  });

  it("stringifies frontmatter with stable formatting", () => {
    expect(
      stringifyFrontmatter(
        {
          date: "2026-06-07",
          mood: "calm",
          tags: ["工作", "家庭"],
          location: "上海 家里",
          favorite: false,
        },
        "# 今天\n\n正文",
      ),
    ).toBe(`---
date: 2026-06-07
mood: calm
tags: [工作, 家庭]
location: "上海 家里"
favorite: false
---

# 今天

正文`);
  });

  it("updates frontmatter without dropping unknown fields", () => {
    const updated = updateFrontmatter(
      `---
date: 2026-06-07
custom_field: keep-me
tags: [旧标签]
---

# 今天`,
      { mood: "calm", tags: ["新标签"] },
    );

    expect(parseFrontmatter(updated).data).toEqual({
      date: "2026-06-07",
      custom_field: "keep-me",
      tags: ["新标签"],
      mood: "calm",
    });
    expect(parseFrontmatter(updated).body).toBe("# 今天");
  });

  it("leaves files without frontmatter as plain body", () => {
    const parsed = parseFrontmatter("# 没有元数据\n\n正文");

    expect(parsed.hasFrontmatter).toBe(false);
    expect(parsed.data).toEqual({});
    expect(parsed.body).toBe("# 没有元数据\n\n正文");
  });
});
