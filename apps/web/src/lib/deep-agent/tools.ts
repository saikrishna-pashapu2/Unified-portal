import { tool } from "langchain";
import { z } from "zod";

interface DeepAgentToolConfig {
  workspaceRoot: string;
  ollamaHost: string;
  ollamaModel: string;
}

export function createDeepAgentTools(config: DeepAgentToolConfig) {
  const runtimeInfo = tool(
    async () => {
      return JSON.stringify(
        {
          provider: "ollama",
          host: config.ollamaHost,
          model: config.ollamaModel,
          workspaceRoot: config.workspaceRoot,
          timestamp: new Date().toISOString(),
        },
        null,
        2,
      );
    },
    {
      name: "get_runtime_info",
      description:
        "Returns current runtime info, model details, and workspace root path.",
      schema: z.object({}),
    },
  );

  const now = tool(
    async () => new Date().toISOString(),
    {
      name: "get_current_datetime",
      description: "Get the current UTC datetime in ISO format.",
      schema: z.object({}),
    },
  );

  return [runtimeInfo, now];
}
