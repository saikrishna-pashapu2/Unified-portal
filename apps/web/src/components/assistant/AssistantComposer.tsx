"use client";

import { FormEvent, useRef, useState } from "react";
import { Loader2, Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AssistantComposerProps {
  isInitializing: boolean;
  isLoading: boolean;
  onSend: (message: string) => Promise<void> | void;
  onStop: () => void;
}

export function AssistantComposer({
  isInitializing,
  isLoading,
  onSend,
  onStop,
}: AssistantComposerProps) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const resize = () => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "0px";
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const message = input.trim();
    if (!message) return;
    setInput("");
    await onSend(message);
    if (textareaRef.current) {
      textareaRef.current.style.height = "44px";
    }
  };

  return (
    <form
      onSubmit={submit}
      className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-sm"
    >
      <textarea
        ref={textareaRef}
        rows={1}
        onInput={resize}
        onKeyDown={async (event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            await submit(event);
          }
        }}
        value={input}
        onChange={(event) => {
          setInput(event.target.value);
          resize();
        }}
        placeholder="Message Assistant..."
        className="min-h-[44px] w-full resize-none rounded-xl border border-transparent bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none ring-0 placeholder:text-slate-400 focus:border-slate-200 focus:bg-white"
      />

      <Button
        type="submit"
        disabled={isInitializing || isLoading || !input.trim()}
        className="h-11 rounded-xl bg-sky-600 px-4 text-white hover:bg-sky-700"
      >
        {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={!isLoading}
        onClick={onStop}
        className="h-11 rounded-xl"
      >
        <Square size={14} />
      </Button>
    </form>
  );
}
