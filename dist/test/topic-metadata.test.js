import { describe, expect, it } from "vitest";
import { buildTopicPresentation } from "../src/topic-metadata.js";
describe("topic metadata", () => {
    it("derives a friendly DM label from participants when the subject is untitled", () => {
        const presentation = buildTopicPresentation({
            topic: {
                id: 7,
                subject: "Untitled",
                parent_topic_id: null,
                root_topic_id: 7,
                spawned_from_chat_id: null
            },
            participants: [
                {
                    id: 1,
                    handle: "agent@example.com",
                    display_name: "OpenClaw Agent"
                },
                {
                    id: 2,
                    handle: "alice@example.com",
                    display_name: "Alice Example"
                }
            ],
            selfHandle: "agent@example.com"
        });
        expect(presentation.kind).toBe("direct");
        expect(presentation.targetId).toBe("direct:7");
        expect(presentation.label).toBe("DM: Alice Example");
        expect(presentation.statusLabel).toBe("direct message");
    });
    it("keeps explicit topic subjects for normal topics", () => {
        const presentation = buildTopicPresentation({
            topic: {
                id: 42,
                subject: "Release planning",
                parent_topic_id: null,
                root_topic_id: 42,
                spawned_from_chat_id: null
            }
        });
        expect(presentation.kind).toBe("topic");
        expect(presentation.targetId).toBe("topic:42");
        expect(presentation.label).toBe("Release planning");
        expect(presentation.groupSubject).toBe("Release planning");
    });
});
//# sourceMappingURL=topic-metadata.test.js.map