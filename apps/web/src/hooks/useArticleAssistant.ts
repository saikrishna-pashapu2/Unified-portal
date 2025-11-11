"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function useArticleAssistant(articleId: number, domain: "esg" | "credit") {
  const [messages, setMessages] = useState<Message[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [followUpQuestions, setFollowUpQuestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Initialize conversation
  useEffect(() => {
    async function init() {
      try {
        setIsInitializing(true);
        const response = await fetch("/api/article-assistant/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ articleId, domain }),
        });

        if (!response.ok) {
          throw new Error("Failed to initialize conversation");
        }

        const data = await response.json();
        setSessionId(data.conversation.sessionId);
        setSummary(data.conversation.summary);
        setSuggestedQuestions(data.conversation.suggestedQuestions || []);
        
        if (data.conversation.messages && data.conversation.messages.length > 0) {
          setMessages(data.conversation.messages);
          setFollowUpQuestions(data.conversation.followUpQuestions || []);
        }
      } catch (error) {
        console.error("Failed to initialize:", error);
      } finally {
        setIsInitializing(false);
      }
    }

    init();
  }, [articleId, domain]);

  // Send message
  async function sendMessage(message: string) {
    if (!sessionId || !message.trim()) return;

    // Add user message
    const userMessage: Message = { role: "user", content: message };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    // Clear suggested/follow-up questions after first message
    setSuggestedQuestions([]);

    // Abort any ongoing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch("/api/article-assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message, domain }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error("Failed to send message");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let assistantMessage = "";

      // Add placeholder assistant message
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.chunk) {
                assistantMessage += data.chunk;
                setMessages((prev) => {
                  const newMessages = [...prev];
                  newMessages[newMessages.length - 1] = {
                    role: "assistant",
                    content: assistantMessage,
                  };
                  return newMessages;
                });
              }

              if (data.followUpQuestions) {
                setFollowUpQuestions(data.followUpQuestions);
              }

              if (data.done) {
                break;
              }
            } catch (e) {
              // Ignore JSON parse errors
            }
          }
        }
      }
    } catch (error: any) {
      if (error.name !== "AbortError") {
        console.error("Error sending message:", error);
        setMessages((prev) => [
          ...prev.slice(0, -1), // Remove placeholder
          {
            role: "assistant",
            content: "Sorry, I encountered an error. Please try again.",
          },
        ]);
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }

  return {
    messages,
    summary,
    suggestedQuestions,
    followUpQuestions,
    isLoading,
    isInitializing,
    sendMessage,
  };
}
