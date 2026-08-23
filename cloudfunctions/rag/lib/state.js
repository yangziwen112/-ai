const { Annotation } = require('@langchain/langgraph')

const WorkflowState = Annotation.Root({
  query: Annotation({ reducer: (_, value) => value, default: () => '' }),
  imageUrls: Annotation({ reducer: (_, value) => value, default: () => [] }),
  userContext: Annotation({ reducer: (_, value) => value, default: () => ({}) }),
  history: Annotation({ reducer: (_, value) => value, default: () => [] }),
  compressedHistory: Annotation({ reducer: (_, value) => value, default: () => [] }),
  safety: Annotation({ reducer: (_, value) => value, default: () => ({}) }),
  now: Annotation({ reducer: (_, value) => value, default: () => Date.now() }),
  intent: Annotation({ reducer: (_, value) => value, default: () => ({}) }),
  evidence: Annotation({ reducer: (_, value) => value, default: () => [] }),
  tools: Annotation({ reducer: (_, value) => value, default: () => [] }),
  toolResults: Annotation({ reducer: (_, value) => value, default: () => [] }),
  links: Annotation({ reducer: (_, value) => value, default: () => [] }),
  draft: Annotation({ reducer: (_, value) => value, default: () => '' }),
  answer: Annotation({ reducer: (_, value) => value, default: () => '' }),
  review: Annotation({ reducer: (_, value) => value, default: () => ({}) }),
  retryCount: Annotation({ reducer: (_, value) => value, default: () => 0 }),
  stage: Annotation({ reducer: (_, value) => value, default: () => 'S' }),
  trace: Annotation({ reducer: (_, value) => value, default: () => [] }),
  traceId: Annotation({ reducer: (_, value) => value, default: () => '' }),
  model: Annotation({ reducer: (_, value) => value, default: () => '' }),
  usage: Annotation({ reducer: (_, value) => value, default: () => ({}) })
})

module.exports = { WorkflowState }
