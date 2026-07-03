import "server-only";
import path from "path";
import { env } from "@/lib/config/env";

export interface DeepAgentRuntimeConfig {
  ollamaHost: string;
  ollamaModel: string;
  ollamaApiKey: string;
  workspaceBaseDir: string;
}

export function getDeepAgentRuntimeConfig(): DeepAgentRuntimeConfig {
  const ollamaHost = env.OLLAMA_HOST;
  const ollamaModel = env.OLLAMA_MODEL;
  const ollamaApiKey = env.OLLAMA_API_KEY?.trim() ?? "";

  if (!ollamaApiKey) {
    throw new Error("Missing OLLAMA_API_KEY for Deep Agent.");
  }

  const workspaceBaseDir = path.join(
    process.cwd(),
    "data",
    "deep-agent-workspaces",
  );

  return {
    ollamaHost,
    ollamaModel,
    ollamaApiKey,
    workspaceBaseDir,
  };
}

export function sanitizePathSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, "_");
}
