"use client";

import { AlertTriangle } from "lucide-react";
import { AssistantConversation } from "@/components/assistant/AssistantConversation";
import { AssistantComposer } from "@/components/assistant/AssistantComposer";
import { AssistantHeader } from "@/components/assistant/AssistantHeader";
import { useDeepAgent } from "@/hooks/useDeepAgent";

export default function AssistantPage() {
  const {
    threadId,
    workspace,
    turns,
    isLoading,
    isInitializing,
    error,
    sendMessage,
    stop,
  } = useDeepAgent();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col px-4 py-6 sm:px-6 sm:py-8">
      <AssistantHeader
        threadId={threadId}
        workspace={workspace}
        isLoading={isLoading}
        isInitializing={isInitializing}
      />

      {error ? (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <AlertTriangle size={16} />
          {error}
        </div>
      ) : null}

      <section className="mt-5 space-y-4">
        <AssistantConversation turns={turns} isLoading={isLoading} />
        <AssistantComposer
          isInitializing={isInitializing}
          isLoading={isLoading}
          onSend={sendMessage}
          onStop={stop}
        />
      </section>
    </main>
  );
}
