import { useEffect, useRef, useState } from "react";

// W17 (LLD_v4 §7): mirrors customerChatServer.ts's two frame shapes exactly
// — this hook never sees a pending/escalated draft body, only what the
// backend already decided was safe to send (a sent-status outbound
// message) or the generic "specialist will respond" status text.
export interface PortalMessage {
  message_id: string;
  direction: "inbound" | "outbound";
  body: string;
  author: string;
  created_at: string;
}

type InboundFrame =
  | ({ type: "message" } & PortalMessage)
  | { type: "status"; text: string };

// W17: connect with the stored customer_token as a query param (same
// accommodation authMiddleware makes for SSE's EventSource — a WS handshake
// can't set custom headers either), dispatch incoming frames, expose a
// send(). Reconnect is deliberately manual, not automatic — a dropped
// connection just means the "Reconnecting…" state below until the user
// revisits the page; customerChatServer.ts's reconnect replay (LLD_v4 §7)
// is what makes that safe to do at any time, not something this hook needs
// to paper over with retry logic.
export function usePortalSocket(customerToken: string | null): {
  messages: PortalMessage[];
  statusText: string | null;
  connected: boolean;
  send: (body: string) => void;
} {
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!customerToken) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/customer-chat?token=${customerToken}`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (event) => {
      const frame = JSON.parse(event.data) as InboundFrame;
      if (frame.type === "message") {
        // A fresh status banner is only relevant until the next real
        // message arrives (e.g. an auto-sent reply superseding "a
        // specialist will respond shortly").
        setStatusText(null);
        setMessages((prev) => [...prev, frame]);
      } else {
        setStatusText(frame.text);
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [customerToken]);

  function send(body: string): void {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ body }));
    // The server only ever pushes *outbound* sent-status messages back
    // (LLD_v4 §7) — a customer's own inbound message is never echoed, so
    // this is the only place it ever lands in `messages`.
    setMessages((prev) => [
      ...prev,
      {
        message_id: `local-${Date.now()}`,
        direction: "inbound",
        body,
        author: "you",
        created_at: new Date().toISOString(),
      },
    ]);
  }

  return { messages, statusText, connected, send };
}
