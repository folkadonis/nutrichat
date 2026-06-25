"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type FileUIPart } from "ai";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { NutritionUIMessage } from "@/agent/nutrition-agent";

function useUserId(): string {
  const [userId] = useState(() => {
    if (typeof window === "undefined") return "web";
    let id = localStorage.getItem("nutri-uid");
    if (!id) {
      id =
        (crypto.randomUUID?.() ??
          `u-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      localStorage.setItem("nutri-uid", id);
    }
    return id;
  });
  return userId;
}

// Downscale + JPEG-compress in the browser so the POST body stays well under
// Vercel's ~4.5MB request limit (raw phone photos blow past it -> 413).
async function shrinkImage(file: File): Promise<FileUIPart> {
  const MAX = 1280;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return {
    type: "file",
    mediaType: "image/jpeg",
    url: canvas.toDataURL("image/jpeg", 0.8),
    filename: file.name.replace(/\.\w+$/, "") + ".jpg",
  };
}

function time(): string {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Page() {
  const userId = useUserId();
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat", body: { userId } }),
    [userId],
  );

  const { messages, sendMessage, status, error } =
    useChat<NutritionUIMessage>({ transport });

  const [input, setInput] = useState("");
  const [files, setFiles] = useState<FileList | undefined>(undefined);
  const [previews, setPreviews] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  // Build/cleanup image previews for selected files
  useEffect(() => {
    if (!files || files.length === 0) {
      setPreviews([]);
      return;
    }
    const urls = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (busy) return;
    const text = input.trim();
    const fl = files;
    if (!text && !fl?.length) return;
    setInput("");
    setFiles(undefined);
    if (fileInputRef.current) fileInputRef.current.value = "";
    const parts = fl
      ? await Promise.all(
          Array.from(fl)
            .filter((f) => f.type.startsWith("image/"))
            .map(shrinkImage),
        )
      : undefined;
    sendMessage({ text: text || "(see photo)", files: parts });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div className="avatar">🥗</div>
        <div className="meta">
          <span className="name">NutriChat</span>
          <span className="sub">
            {busy ? "typing…" : "Nutrition coach · online"}
          </span>
        </div>
      </header>

      <div className="messages">
        {messages.length === 0 && (
          <div className="empty">
            <div className="big">🍽</div>
            Send a photo of your meal or describe it
            <br />
            (e.g. &ldquo;2 chapati and egg gravy, 2 eggs&rdquo;)
            <br />
            <br />
            I&rsquo;ll estimate calories &amp; macros and keep your daily total.
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`row ${m.role}`}>
            <div className="bubble">
              {m.parts.map((part, i) => {
                if (part.type === "text") {
                  return <span key={i}>{part.text}</span>;
                }
                if (part.type === "file" && part.mediaType?.startsWith("image/")) {
                  return (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={part.url} alt={part.filename ?? "photo"} />
                  );
                }
                return null;
              })}
              <span className="time">{time()}</span>
            </div>
          </div>
        ))}

        {status === "submitted" && (
          <div className="row assistant">
            <div className="bubble">
              <span className="typing">
                <span />
                <span />
                <span />
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="error">Something went wrong. Please try again.</div>
        )}

        <div ref={endRef} />
      </div>

      {previews.length > 0 && (
        <div className="previews">
          {previews.map((src, i) => (
            <div className="thumb" key={i}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="preview" />
              {i === 0 && (
                <button
                  type="button"
                  className="rm"
                  aria-label="remove"
                  onClick={() => {
                    setFiles(undefined);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <form className="composer" onSubmit={submit}>
        <div className="field">
          <button
            type="button"
            className="icon-btn"
            aria-label="attach photo"
            onClick={() => fileInputRef.current?.click()}
          >
            📎
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => setFiles(e.target.files ?? undefined)}
          />
          <textarea
            value={input}
            placeholder="Message"
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <button
          type="submit"
          className="send-btn"
          aria-label="send"
          disabled={busy || (!input.trim() && !files?.length)}
        >
          ➤
        </button>
      </form>
    </div>
  );
}
