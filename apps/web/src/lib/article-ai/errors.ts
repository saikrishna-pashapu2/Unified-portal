import "server-only";

export class ArticleAiError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 404 | 409 | 503 = 400,
    readonly code = "article_ai_error",
  ) {
    super(message);
    this.name = "ArticleAiError";
  }
}

export class ArticleAiUnauthorizedError extends ArticleAiError {
  constructor(message = "Active account required") {
    super(message, 401, "inactive_account");
    this.name = "ArticleAiUnauthorizedError";
  }
}

export class ArticleAiNotFoundError extends ArticleAiError {
  constructor(message = "Article or selection not found") {
    super(message, 404, "not_found");
    this.name = "ArticleAiNotFoundError";
  }
}

export class ArticleAiConflictError extends ArticleAiError {
  constructor(message = "Selection changed; refresh and try again") {
    super(message, 409, "version_conflict");
    this.name = "ArticleAiConflictError";
  }
}

export class ArticleAiProviderError extends ArticleAiError {
  constructor(message = "Article AI provider unavailable") {
    super(message, 503, "provider_unavailable");
    this.name = "ArticleAiProviderError";
  }
}
