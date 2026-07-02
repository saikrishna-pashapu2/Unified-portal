import "server-only";
import path from "path";

export interface DeepAgentRuntimeConfig {
  ollamaHost: string;
  ollamaModel: string;
  ollamaApiKey: string;
  workspaceBaseDir: string;
}

function readEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function getDeepAgentRuntimeConfig(): DeepAgentRuntimeConfig {
  const ollamaHost = readEnv("OLLAMA_HOST") || "https://ollama.com";
  const ollamaModel = readEnv("OLLAMA_MODEL") || "minimax-m2.5:cloud";
  const ollamaApiKey = readEnv("OLLAMA_API_KEY");

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
