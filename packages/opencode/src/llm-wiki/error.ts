import { Schema } from "effect"

export class LlmWikiUnavailableError extends Schema.TaggedErrorClass<LlmWikiUnavailableError>()(
  "LlmWikiUnavailableError",
  {
    message: Schema.String,
    status: Schema.optional(Schema.Number),
  },
  { httpApiStatus: 503 },
) {}

export class LlmWikiUnauthorizedError extends Schema.TaggedErrorClass<LlmWikiUnauthorizedError>()(
  "LlmWikiUnauthorizedError",
  {
    message: Schema.String,
  },
  { httpApiStatus: 401 },
) {}

export class LlmWikiNotFoundError extends Schema.TaggedErrorClass<LlmWikiNotFoundError>()(
  "LlmWikiNotFoundError",
  {
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}
