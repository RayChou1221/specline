export default {
  name: "specline",
  config(ctx) {
    return { skills: [".opencode/skills"] };
  },
  "experimental.chat.messages.transform"(messages, ctx) {
    // Inject using-specline bootstrap on first message
    return messages;
  }
};
