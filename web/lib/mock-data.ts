import type { Story } from "./contracts";

const samples = [
  ["mock-new-beginning", "在新的地方，重新找到盼望", "搬到陌生城市以後，一個人在新環境中慢慢找到陪伴。"],
  ["mock-waiting", "等待中的小小亮光", "面對人生轉折時，一段關於耐心與信心的示意故事。"],
  ["mock-friendship", "一段重新連結的友誼", "在忙碌生活中，有人選擇再次關心老朋友。"],
  ["mock-courage", "跨出小小的一步", "面對陌生挑戰，有人學習勇敢表達自己的需要。"],
  ["mock-rest", "練習停下來", "平凡日常中的休息與安靜，成為一個重新出發的契機。"],
  ["mock-kindness", "一份意料之外的善意", "當生活不如預期，一份簡單的關懷帶來改變。"],
] as const;

// All entries are fictional and intentionally have no external publisher link.
export const mockStories: Story[] = samples.map(([id, title, excerpt], i) => ({
  id, contentType: "testimony", title, excerpt,
  sourceName: "虛構範例（非真實見證）", sourceUrl: null, topics: [],
  publishedAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(), isMock: true,
}));
