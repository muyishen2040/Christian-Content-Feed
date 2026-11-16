import type { Story } from "./contracts.ts";

// An image may be displayed for real stories only when the catalog explicitly
// supplies an HTTPS URL and confirms that display rights were reviewed.
export function storyVisual(story: Story, rank: number): {
  className: string;
  backgroundImage?: string;
  hasImage: boolean;
} {
  if (story.isMock) {
    return {
      className: `story-cover--${(rank - 1) % 4}`,
      hasImage: true,
    };
  }
  if (story.thumbnailApproved === true && story.thumbnailUrl) {
    try {
      const url = new URL(story.thumbnailUrl);
      if (url.protocol === "https:") {
        return {
          className: "story-cover--authorized-image",
          backgroundImage: `linear-gradient(180deg, rgb(13 23 23 / 28%) 0%, rgb(12 24 21 / 86%) 100%), url(${JSON.stringify(url.href)})`,
          hasImage: true,
        };
      }
    } catch {
      // Invalid source metadata should be rendered with the safe text fallback.
    }
  }
  return { className: "story-cover--no-image", hasImage: false };
}
