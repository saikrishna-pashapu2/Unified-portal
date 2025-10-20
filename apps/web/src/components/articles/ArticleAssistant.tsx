"use client";

/**
 * Article Assistant Chat Component
 * Provides AI-powered chat interface for article Q&A
 */

import { useState, useEffect, useRef } from "react";
import { Send, Sparkles, Loader2, Bot, User, ChevronDown, ChevronUp } from "lucide-react";
import ReactMarkdown from "react-markdown";
import dynamic from 'next/dynamic';

// Dynamically import ChartDisplay to avoid SSR issues
const ChartDisplay = dynamic(() => import('./ChartDisplay'), { ssr: false });

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  isSummary?: boolean; // Flag to identify the summary message
  isStreaming?: boolean; // Flag to show streaming cursor
}

interface ArticleAssistantProps {
  articleId: number;
  domain: "esg" | "credit";
  articleTitle: string;
}

export default function ArticleAssistant({
  articleId,
  domain,
  articleTitle,
}: ArticleAssistantProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [usedSuggestions, setUsedSuggestions] = useState<Set<number>>(new Set());
  const [isSuggestionsExpanded, setIsSuggestionsExpanded] = useState(true);
  const [hasUserInteracted, setHasUserInteracted] = useState(false); // Track if user has asked a question
  const [assistantStatus, setAssistantStatus] = useState<"idle" | "thinking" | "searching" | "responding">("idle");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Initialize conversation
  useEffect(() => {
    async function initConversation() {
      try {
        const response = await fetch("/api/article-assistant/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ articleId, domain }),
        });

        const data = await response.json();
        
        console.log("Init response:", data);

        if (data.success) {
          setSessionId(data.conversation.sessionId);
          setSummary(data.conversation.summary);
          setSuggestedQuestions(data.conversation.suggestedQuestions || []);

          // Build message array with summary and existing messages
          const messageList: Message[] = [];

          // Add summary as first message
          if (data.conversation.summary) {
            messageList.push({
              role: "assistant",
              content: data.conversation.summary,
              isSummary: true,
            });
          }

          // Add existing conversation messages (if any)
          if (data.conversation.messages && data.conversation.messages.length > 0) {
            const existingMessages = data.conversation.messages.map((msg: any) => ({
              role: msg.role as "user" | "assistant" | "system",
              content: msg.content.replace(/🔍 Searching the web\.\.\.\n\n/g, '').trim(), // Remove search indicator
            }));
            messageList.push(...existingMessages);
            
            // If there are existing messages, user has already interacted
            setHasUserInteracted(true);
            setIsSuggestionsExpanded(false);
          }

          setMessages(messageList);
        } else {
          console.error("Init failed:", data.error);
          setMessages([
            {
              role: "assistant",
              content: "Hi! I'm ready to answer questions about this article. What would you like to know?",
            },
          ]);
        }
      } catch (error) {
        console.error("Failed to initialize conversation:", error);
        setMessages([
          {
            role: "assistant",
            content: "Hi! I'm ready to answer questions about this article. What would you like to know?",
          },
        ]);
      } finally {
        setIsInitializing(false);
      }
    }

    initConversation();
  }, [articleId, domain]);

  // Function to render message content with charts
  const renderMessageContent = (content: string) => {
    // Check if content contains chart markers
    const chartRegex = /<CHART>(.*?)<\/CHART>/g;
    const parts: JSX.Element[] = [];
    let lastIndex = 0;
    let match;
    let partIndex = 0;

    while ((match = chartRegex.exec(content)) !== null) {
      // Add text before the chart
      if (match.index > lastIndex) {
        const textBefore = content.substring(lastIndex, match.index);
        parts.push(
          <ReactMarkdown
            key={`text-${partIndex++}`}
            components={{
              a: ({ href, children }) => (
                <a 
                  href={href} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-700 underline font-medium inline-flex items-center gap-1"
                >
                  {children}
                  <span className="text-xs">🔗</span>
                </a>
              ),
            }}
          >
            {textBefore}
          </ReactMarkdown>
        );
      }

      // Add the chart
      try {
        const chartData = JSON.parse(match[1]);
        parts.push(<ChartDisplay key={`chart-${partIndex++}`} chartData={chartData} />);
      } catch (e) {
        console.error('Failed to parse chart data:', e);
      }

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text after last chart
    if (lastIndex < content.length) {
      const textAfter = content.substring(lastIndex);
      parts.push(
        <ReactMarkdown
          key={`text-${partIndex++}`}
          components={{
            a: ({ href, children }) => (
              <a 
                href={href} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-700 underline font-medium inline-flex items-center gap-1"
              >
                {children}
                <span className="text-xs">🔗</span>
              </a>
            ),
          }}
        >
          {textAfter}
        </ReactMarkdown>
      );
    }

    // If no charts found, render normally
    if (parts.length === 0) {
      return (
        <ReactMarkdown
          components={{
            a: ({ href, children }) => (
              <a 
                href={href} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-700 underline font-medium inline-flex items-center gap-1"
              >
                {children}
                <span className="text-xs">🔗</span>
              </a>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      );
    }

    return <>{parts}</>;
  };

  // Send message
  async function sendMessage() {
    if (!input.trim() || !sessionId || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    setIsLoading(true);
    setAssistantStatus("thinking");
    
    // Collapse suggestions after first interaction
    if (!hasUserInteracted) {
      setHasUserInteracted(true);
    }
    setIsSuggestionsExpanded(false);

    // Add user message
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);

    try {
      const response = await fetch("/api/article-assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          message: userMessage,
          domain,
        }),
      });

      if (!response.body) {
        throw new Error("No response body");
      }

      // Handle streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantMessage = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          setAssistantStatus("idle");
          break;
        }

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.chunk) {
                // Check if we're searching the web
                if (data.chunk.includes("🔍")) {
                  setAssistantStatus("searching");
                  // Don't add the search indicator to the message content
                } else {
                  // We're now streaming actual content
                  setAssistantStatus("responding");

                  // Add chunk to message
                  assistantMessage += data.chunk;
                  
                  // Update the last message
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastIndex = newMessages.length - 1;
                    if (lastIndex >= 0 && newMessages[lastIndex].role === "assistant") {
                      newMessages[lastIndex] = {
                        ...newMessages[lastIndex],
                        content: assistantMessage,
                        isStreaming: true,
                      };
                    } else {
                      // Create new assistant message if it doesn't exist
                      newMessages.push({
                        role: "assistant",
                        content: assistantMessage,
                        isStreaming: true,
                      });
                    }
                    return newMessages;
                  });
                }
              }

              // Handle follow-up questions
              if (data.followUpQuestions && Array.isArray(data.followUpQuestions)) {
                setSuggestedQuestions(data.followUpQuestions);
                setUsedSuggestions(new Set()); // Reset used suggestions
                // Only auto-expand for the first interaction
                if (!hasUserInteracted) {
                  setIsSuggestionsExpanded(true);
                }
              }

              if (data.done) {
                break;
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      console.error("Failed to send message:", error);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, I encountered an error. Please try again.",
        },
      ]);
    } finally {
      setIsLoading(false);
      setAssistantStatus("idle");
      
      // Mark the last message as no longer streaming
      setMessages((prev) => {
        const newMessages = [...prev];
        const lastIndex = newMessages.length - 1;
        if (lastIndex >= 0 && newMessages[lastIndex].isStreaming) {
          newMessages[lastIndex] = {
            ...newMessages[lastIndex],
            isStreaming: false,
          };
        }
        return newMessages;
      });
    }
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
        {isInitializing ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Loader2 className="w-8 h-8 animate-spin text-purple-600 mx-auto mb-2" />
              <p className="text-sm text-gray-500">Analyzing article...</p>
            </div>
          </div>
        ) : (
          <>
            {messages.map((message, index) => {
              // Special rendering for summary card
              if (message.isSummary) {
                return (
                  <div key={index} className="mb-4">
                    <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-xl border border-purple-200 overflow-hidden shadow-sm">
                      {/* Summary Content */}
                      <div className="p-4">
                        <div className="prose prose-sm max-w-none text-gray-700 
                          [&_h2]:text-xs [&_h2]:font-semibold [&_h2]:text-purple-800 [&_h2]:uppercase [&_h2]:tracking-wide [&_h2]:mb-3 [&_h2]:mt-4
                          [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:text-purple-800 [&_h3]:uppercase [&_h3]:tracking-wide [&_h3]:mb-2 [&_h3]:mt-3
                          [&_p]:text-sm [&_p]:leading-relaxed [&_p]:text-gray-700 [&_p]:mb-3
                          [&_ul]:mt-2 [&_ul]:mb-3 [&_ul]:space-y-2 [&_ul]:list-disc [&_ul]:pl-5
                          [&_ol]:mt-2 [&_ol]:mb-3 [&_ol]:space-y-2 [&_ol]:list-decimal [&_ol]:pl-5
                          [&_li]:text-sm [&_li]:leading-relaxed [&_li]:text-gray-700 [&_li]:ml-0
                          [&_li>p]:mb-0
                          [&_strong]:text-purple-900 [&_strong]:font-semibold
                          [&>*:first-child]:mt-0
                          [&>*:last-child]:mb-0">
                          <ReactMarkdown>{message.content}</ReactMarkdown>
                        </div>
                        <div className="mt-4 pt-3 border-t border-purple-200">
                          <p className="text-xs text-purple-700 italic">
                            💡 Feel free to ask me any questions about the article!
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }

              // Regular chat messages
              return (
                <div
                  key={index}
                  className={`flex gap-3 ${
                    message.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  {message.role === "assistant" && (
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
                      <Bot className="w-5 h-5 text-purple-600" />
                    </div>
                  )}

                  <div
                    className={`max-w-[85%] rounded-xl p-4 shadow-sm ${
                      message.role === "user"
                        ? "bg-gradient-to-r from-blue-600 to-blue-500 text-white"
                        : "bg-white text-gray-900 border border-gray-200"
                    } ${message.isStreaming && !message.content ? 'min-h-[3rem]' : ''}`}
                  >
                    {message.role === "assistant" ? (
                      <div className="prose prose-sm max-w-none text-sm 
                        [&_p]:text-sm [&_p]:leading-relaxed [&_p]:mb-3
                        [&_li]:text-sm [&_li]:leading-relaxed [&_li]:mb-1
                        [&_ul]:my-2 [&_ul]:space-y-1
                        [&_ol]:my-2 [&_ol]:space-y-1
                        [&_strong]:text-gray-900 [&_strong]:font-semibold
                        [&_a]:text-blue-600 [&_a]:underline [&_a]:font-medium [&_a]:hover:text-blue-700
                        [&_a]:cursor-pointer [&_a]:break-words
                        [&_code]:text-xs [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded
                        [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-2 [&_h3]:text-gray-800
                        [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:mt-2 [&_h4]:mb-1 [&_h4]:text-gray-700
                        [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                        {message.content ? renderMessageContent(message.content) : null}
                        {message.isStreaming && message.content && (
                          <span className="inline-block w-2 h-4 ml-1 bg-purple-600 animate-pulse"></span>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm leading-relaxed">{message.content}</p>
                    )}
                  </div>

                  {message.role === "user" && (
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                      <User className="w-5 h-5 text-blue-600" />
                    </div>
                  )}
                </div>
              );
            })}
            
            {/* Redesigned Loading/Status Animation */}
            {assistantStatus !== "idle" && assistantStatus !== "responding" && (
              <div className="flex gap-3 justify-start animate-in fade-in duration-300">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-purple-100 to-blue-100 flex items-center justify-center">
                  <Bot className="w-5 h-5 text-purple-600" />
                </div>
                <div className="bg-gradient-to-r from-gray-50 to-gray-100 rounded-2xl px-4 py-3 shadow-sm border border-gray-200">
                  <div className="flex items-center gap-3">
                    {assistantStatus === "thinking" && (
                      <>
                        <div className="flex gap-1.5">
                          <span className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0ms', animationDuration: '1s' }}></span>
                          <span className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '200ms', animationDuration: '1s' }}></span>
                          <span className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '400ms', animationDuration: '1s' }}></span>
                        </div>
                        <span className="text-sm font-medium text-gray-700">Thinking...</span>
                      </>
                    )}
                    {assistantStatus === "searching" && (
                      <>
                        <div className="relative">
                          <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                          <span className="absolute inset-0 w-5 h-5 text-blue-400 animate-ping opacity-20">
                            <Loader2 className="w-5 h-5" />
                          </span>
                        </div>
                        <span className="text-sm font-medium text-gray-700">Searching web...</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-200">
        {/* Suggested Questions - Collapsible */}
        {suggestedQuestions.length > 0 && (
          <div className="mb-3">
            {/* Header with toggle */}
            <button
              onClick={() => setIsSuggestionsExpanded(!isSuggestionsExpanded)}
              className="w-full flex items-center justify-between gap-2 mb-2 px-2 py-1.5 rounded-lg hover:bg-purple-50 transition-colors group"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                <p className="text-xs font-medium text-purple-700">
                  {messages.length === 1 
                    ? `Suggested questions (${suggestedQuestions.length})` 
                    : `Follow-up questions (${suggestedQuestions.length})`}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-purple-600 opacity-0 group-hover:opacity-100 transition-opacity">
                  {isSuggestionsExpanded ? "Hide" : "Show"}
                </span>
                {isSuggestionsExpanded ? (
                  <ChevronUp className="w-4 h-4 text-purple-600" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-purple-600" />
                )}
              </div>
            </button>
            
            {/* Collapsible content */}
            {isSuggestionsExpanded && (
              <div className="flex flex-wrap gap-2 animate-in slide-in-from-top-2 duration-200">
                {suggestedQuestions.map((question, index) => {
                  const isUsed = usedSuggestions.has(index);
                  
                  return (
                    <button
                      key={index}
                      onClick={() => {
                        setInput(question);
                        setUsedSuggestions(prev => new Set(prev).add(index));
                        // Mark as interacted and collapse
                        if (!hasUserInteracted) {
                          setHasUserInteracted(true);
                        }
                        setIsSuggestionsExpanded(false);
                        // Auto-focus input after setting question
                        setTimeout(() => {
                          const inputEl = document.querySelector('input[type="text"]') as HTMLInputElement;
                          inputEl?.focus();
                        }, 0);
                      }}
                      disabled={isLoading || isInitializing}
                      className={`group relative px-3 py-2 text-xs rounded-lg
                        transition-all duration-200
                        disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
                        ${isUsed 
                          ? 'text-gray-500 bg-gray-50 border border-gray-200 opacity-60' 
                          : 'text-purple-700 bg-gradient-to-br from-purple-50/80 to-blue-50/80 backdrop-blur-sm border border-purple-200/50 hover:from-purple-100/90 hover:to-blue-100/90 hover:border-purple-300/70 hover:shadow-md hover:scale-[1.02] active:scale-[0.98]'
                        }`}
                      title={isUsed ? "Already asked" : "Click to use this question"}
                    >
                      <span className="relative z-10 flex items-center gap-1.5">
                        <Sparkles className={`w-3 h-3 ${isUsed ? 'text-gray-400' : 'text-purple-500 group-hover:text-purple-600'}`} />
                        <span className={`font-medium leading-tight ${isUsed ? 'line-through' : ''}`}>
                          {question}
                        </span>
                        {isUsed && <span className="text-xs">✓</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
            placeholder="Ask a question about the article..."
            disabled={isLoading || isInitializing}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
          />
          <button
            onClick={sendMessage}
            disabled={isLoading || isInitializing || !input.trim()}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Press Enter to send • Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
