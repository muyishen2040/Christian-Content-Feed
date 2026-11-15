import type { Story } from "./contracts.ts";

// Stable fixture UUIDs agree with Supabase's testimony ID type.
const samples = [
  ["在新的地方，重新找到盼望", "搬到陌生城市以後，一個人在新環境中慢慢找到陪伴。"],
  ["等待中的小小亮光", "面對人生轉折時，一段關於耐心與信心的虛構示意故事。"],
  ["一段重新連結的友誼", "在忙碌生活中，有人選擇再次關心老朋友。"],
  ["跨出小小的一步", "面對陌生挑戰，有人學習勇敢表達自己的需要。"],
  ["練習停下來", "平凡日常中的休息與安靜，成為重新出發的契機。"],
  ["一份意料之外的善意", "當生活不如預期，一份簡單的關懷帶來改變。"],
] as const;

// All summaries below are our fictional example text, not publisher excerpts.
export const mockStories: Story[] = samples.map(([title, summary], i) => ({
  id: `00000000-0000-4000-8000-${String(i + 101).padStart(12, "0")}`,
  contentType: "testimony",
  title,
  summary,
  sourceName: "虛構範例（非真實見證）",
  sourceUrl: null,
  topics: [],
  publishedAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
  isMock: true,
}));
