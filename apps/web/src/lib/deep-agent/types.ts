export type DeepAgentStreamEventType =
  | "status"
  | "thinking_delta"
  | "answer_delta"
  | "thought_transition"
  | "tool_call"
  | "tool_result"
  | "subagent_start"
  | "subagent_end"
  | "todo_update"
  | "state_update"
  | "debug"
  | "error"
  | "done";

export interface DeepAgentStreamEvent {
  type: DeepAgentStreamEventType;
  threadId: string;
  timestamp: string;
  content?: string;
  reasoning?: string;
  nodePath?: string[];
  node?: string;
  metadata?: Record<string, unknown>;
  toolName?: string;
  toolCallId?: string;
  toolArgs?: unknown;
  taskId?: string;
  taskName?: string;
  done?: boolean;
}

export interface DeepAgentInitResponse {
  success: boolean;
  threadId: string;
  workspace: string;
  model: {
    host: string;
    name: string;
  };
}

export interface DeepAgentInitRequest {
  threadId?: string;
}

export interface DeepAgentChatRequest {
  threadId?: string;
  message: string;
}
