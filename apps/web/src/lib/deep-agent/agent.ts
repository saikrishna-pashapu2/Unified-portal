import "server-only";
import fs from "fs/promises";
import path from "path";
import { ChatOllama } from "@langchain/ollama";
import { createDeepAgent, FilesystemBackend, type SubAgent } from "deepagents";
import { InMemoryStore, MemorySaver } from "@langchain/langgraph";
import { v4 as uuidv4 } from "uuid";
import {
  getDeepAgentRuntimeConfig,
  sanitizePathSegment,
} from "@/lib/deep-agent/config";
import { createDeepAgentTools } from "@/lib/deep-agent/tools";

interface GlobalDeepAgentState {
  __deepAgentCheckpointer?: MemorySaver;
  __deepAgentStore?: InMemoryStore;
}

const globalState = globalThis as typeof globalThis & GlobalDeepAgentState;

function getCheckpointer(): MemorySaver {
  if (!globalState.__deepAgentCheckpointer) {
    globalState.__deepAgentCheckpointer = new MemorySaver();
  }
  return globalState.__deepAgentCheckpointer;
}

function getStore(): InMemoryStore {
  if (!globalState.__deepAgentStore) {
    globalState.__deepAgentStore = new InMemoryStore();
  }
  return globalState.__deepAgentStore;
}

export interface DeepAgentSessionContext {
  threadId: string;
  userId: string;
  workspaceRoot: string;
  workspaceRelative: string;
}

export async function getDeepAgentSessionContext(input: {
  threadId?: string;
  userId?: string | null;
}): Promise<DeepAgentSessionContext> {
  const config = getDeepAgentRuntimeConfig();
  const threadId = sanitizePathSegment(input.threadId?.trim() || uuidv4());
  const userId = sanitizePathSegment(input.userId?.trim() || "anonymous");
  const workspaceRelative = path.join(userId, threadId);
  const workspaceRoot = path.join(config.workspaceBaseDir, workspaceRelative);

  await fs.mkdir(workspaceRoot, { recursive: true });

  return {
    threadId,
    userId,
    workspaceRoot,
    workspaceRelative,
  };
}

function getSystemPrompt(workspaceRoot: string): string {
  return `You are a personal deep assistant for ESG Portal users.

Core behavior:
- Reason carefully before finalizing.
- Use tools when they improve correctness.
- Use filesystem tools actively for context management.
- Keep user-facing responses concise and structured.

Streaming transparency requirements:
- When a task is complex, keep todos up to date.
- Prefer subagents for isolated deep investigations.
- If using tools, clearly reflect findings in final answer.

File management rules:
- Workspace root: ${workspaceRoot}
- Persist intermediate notes, plans, and extracted facts in files.
- Prefer reading/writing files over keeping very large context in memory.
- Never access data outside the workspace root.
`;
}

function buildOllamaHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "X-API-Key": apiKey,
  };
}

export interface DeepAgentRuntime {
  agent: ReturnType<typeof createDeepAgent>;
  context: DeepAgentSessionContext;
  model: {
    host: string;
    name: string;
  };
}

export async function createDeepAgentRuntime(input: {
  threadId?: string;
  userId?: string | null;
}): Promise<DeepAgentRuntime> {
  const config = getDeepAgentRuntimeConfig();
  const context = await getDeepAgentSessionContext(input);

  const model = new ChatOllama({
    baseUrl: config.ollamaHost,
    model: config.ollamaModel,
    headers: buildOllamaHeaders(config.ollamaApiKey),
    temperature: 0.2,
    think: true,
  });

  const tools = createDeepAgentTools({
    workspaceRoot: context.workspaceRoot,
    ollamaHost: config.ollamaHost,
    ollamaModel: config.ollamaModel,
  });

  const subagents: SubAgent[] = [
    {
      name: "research-specialist",
      description:
        "Use for deep research synthesis and evidence organization tasks.",
      systemPrompt:
        "You are a precise research specialist. Gather evidence, synthesize, and return structured findings.",
    },
    {
      name: "file-manager",
      description:
        "Use for intensive file organization, summarization, and memory hygiene in the workspace.",
      systemPrompt:
        "You are a strict file manager. Organize notes, deduplicate files, and keep structured artifacts clean.",
    },
  ];

  const agent = createDeepAgent({
    name: "personal-deep-agent",
    model,
    tools,
    systemPrompt: getSystemPrompt(context.workspaceRoot),
    subagents,
    backend: new FilesystemBackend({ rootDir: context.workspaceRoot }),
    checkpointer: getCheckpointer(),
    store: getStore(),
  });

  return {
    agent,
    context,
    model: {
      host: config.ollamaHost,
      name: config.ollamaModel,
    },
  };
}
