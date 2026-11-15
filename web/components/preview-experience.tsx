"use client";

import { useState } from "react";
import type { Story } from "@/lib/contracts";
import { FeedbackActions } from "./ui/feedback-actions";
import { TestimonyCard } from "./ui/testimony-card";

type Reaction = "interested" | "not_for_me" | null;
type LocalState = { reaction: Reaction; saved: boolean };

export function PreviewExperience({ stories }: { stories: Story[] }) {
  const [feedback, setFeedback] = useState<Record<string, LocalState>>({});
  const update = (id: string, change: Partial<LocalState>) => {
    setFeedback((current) => ({
      ...current,
      [id]: { reaction: null, saved: false, ...current[id], ...change },
    }));
  };

  return (
    <div className="story-grid" data-testid="story-grid">
      {stories.map((story, index) => {
        const selected = feedback[story.id] ?? { reaction: null, saved: false };
        return (
          <TestimonyCard
            key={story.id}
            story={story}
            number={index + 1}
            actions={
              <FeedbackActions
                label={`${story.title}的回饋`}
                reaction={selected.reaction}
                saved={selected.saved}
                onInterested={() =>
                  update(story.id, {
                    reaction:
                      selected.reaction === "interested" ? null : "interested",
                  })
                }
                onNotForMe={() =>
                  update(story.id, {
                    reaction:
                      selected.reaction === "not_for_me" ? null : "not_for_me",
                  })
                }
                onSave={() => update(story.id, { saved: !selected.saved })}
              />
            }
          />
        );
      })}
    </div>
  );
}
