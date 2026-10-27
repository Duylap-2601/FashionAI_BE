# FashionAI Realtime Integration Guide for Frontend

**Effective from**: August 25, 2026  
**Backend Version**: Phase 3 (Chat WS migration) + Phase 4 (tests & observability)

---

## Overview

FashionAI backend now supports real-time features via **Socket.IO**:
- **Notifications** (order updates, payments, promotions)
- **Chat** (AI Chatbot via WebSocket — SSE deprecated but kept for backward compat)

Both features share a single WS connection and socket handshake, reducing overhead. This guide tells you exactly how to connect, authenticate, listen for events, and handle disconnections.

---

## 1. Connection & Setup

### 1.1 Install Socket.IO Client

```bash
npm install socket.io-client
```

### 1.2 WS URL vs API URL

**Important**: WebSocket connects to the **backend origin** (NOT the REST API URL with `/api` prefix).

| Environment | REST API URL | WebSocket URL |
|-------------|--------------|---------------|
| Local dev   | `http://localhost:3002/api` | `ws://localhost:3002` |
| Staging     | `https://api-staging.onrender.com/api` | `wss://api-staging.onrender.com` |
| Production  | `https://api.fashionai.com/api` | `wss://api.fashionai.com` |

**Why different?** NestJS `setGlobalPrefix('api')` only applies to REST routes, not Socket.IO. Socket.IO connects directly to root, then Socket.IO client auto-discovers `/socket.io/` path.

**In your `.env`**:
```bash
NEXT_PUBLIC_API_URL=http://localhost:3002/api          # ← REST with /api
NEXT_PUBLIC_WS_URL=http://localhost:3002               # ← WS without /api
```

### 1.3 Initialize Realtime Connection

```typescript
import { io, Socket } from 'socket.io-client';

const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3002';

// Connect to the main realtime server (notifications + general events)
// Default namespace: '/'
const realtimeSocket: Socket = io(wsUrl, {
  transports: ['websocket'], // Only WS (polling not supported on Render)
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5,
  // Auth token will be sent on next step
});

// Connect to chat namespace separately (recommended for cleaner event handling)
// Namespace embedded in URL path: '/chat'
const chatSocket: Socket = io(`${wsUrl}/chat`, {
  transports: ['websocket'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5,
});
```

⚠️ **Note**: Both sockets share the **same underlying WebSocket connection** (Socket.IO multiplex)—no extra socket overhead.

### 1.4 Authentication Handshake

Pass your **access token** (JWT) during connection. Both sockets use the same authentication mechanism:

```typescript
// Get your access token (from login response or localStorage)
const accessToken = localStorage.getItem('access_token');

// Connect with token
const realtimeSocket: Socket = io(wsUrl, {
  // ... options from 1.3
  auth: {
    token: accessToken, // Sent during handshake
  },
});

const chatSocket: Socket = io(`${wsUrl}/chat`, {
  // ... options from 1.3
  auth: {
    token: accessToken,
  },
});

// Handle connection success
realtimeSocket.on('connect', () => {
  console.log('✓ Connected to realtime server');
});

chatSocket.on('connect', () => {
  console.log('✓ Connected to chat server');
});

// Handle auth failure (401 from backend)
realtimeSocket.on('connect_error', (error: any) => {
  if (error.message === 'UNAUTHORIZED') {
    console.error('❌ Authentication failed. Re-login required.');
    // Redirect user to login or refresh token
  }
});

chatSocket.on('connect_error', (error: any) => {
  if (error.message === 'UNAUTHORIZED') {
    console.error('❌ Chat auth failed.');
  }
});
```

---

## 2. Listening for Notifications

### 2.1 Notification Event

Subscribe to the `notification` event on the realtime socket:

```typescript
realtimeSocket.on('notification', (notification) => {
  console.log('📬 New notification:', notification);

  // notification shape:
  // {
  //   id: string (UUID),
  //   userId: string,
  //   type: 'ORDER_STATUS' | 'PAYMENT' | 'PROMOTION' | 'SYSTEM',
  //   title: string,
  //   message: string,
  //   data: { ... }, // Optional context (e.g., { orderId, orderCode, status })
  //   isRead: boolean,
  //   createdAt: ISO timestamp
  // }

  // Show a toast or badge update
  showNotificationToast(notification.title, notification.message);
  incrementUnreadBadge();
});
```

### 2.2 REST APIs for Notification Management

While realtime events notify you immediately, the source of truth is your DB. Use REST for:

**List notifications:**
```
GET /api/notifications?page=1&limit=20
Authorization: Bearer <access_token>
```

Response:
```json
{
  "success": true,
  "data": {
    "items": [...],
    "meta": {
      "total": 42,
      "unread": 5,
      "page": 1,
      "limit": 20,
      "totalPages": 3
    }
  }
}
```

**Get unread count:**
```
GET /api/notifications/unread-count
Authorization: Bearer <access_token>
```

Response:
```json
{
  "success": true,
  "data": { "unread": 5 }
}
```

**Mark single notification as read:**
```
PATCH /api/notifications/:id/read
Authorization: Bearer <access_token>
```

**Mark all as read:**
```
PATCH /api/notifications/read-all
Authorization: Bearer <access_token>
```

---

## 3. Token Refresh (Long-lived Connections)

Access tokens have **15-minute expiry**. Socket connections may stay alive longer, so refresh before expiry.

### 3.1 Listen for Token Expiry Warnings

The server emits two events:

```typescript
realtimeSocket.on('token:expiring', ({ expiresInMs }) => {
  console.warn(`⏰ Token expires in ${expiresInMs}ms. Refreshing...`);
  refreshAccessToken().then((newToken) => {
    realtimeSocket.emit('auth:refresh', { token: newToken });
  });
});

realtimeSocket.on('token:expired', () => {
  console.error('🔴 Token expired, disconnecting.');
  // Socket will auto-disconnect; user should re-login
});
```

Do the same for `chatSocket` if you want to stay cautious (but the main socket usually triggers first).

### 3.2 Proactive Refresh (Optional)

Or refresh proactively without waiting for server:

```typescript
async function keepConnectionAlive(socket: Socket) {
  const checkInterval = setInterval(async () => {
    const expiry = localStorage.getItem('token_exp'); // Unix timestamp
    const now = Math.floor(Date.now() / 1000);
    const secsLeft = (expiry ? parseInt(expiry) : now) - now;

    if (secsLeft < 60) {
      const newToken = await refreshAccessToken();
      socket.emit('auth:refresh', { token: newToken });
    }
  }, 30_000); // Check every 30s
}

keepConnectionAlive(realtimeSocket);
keepConnectionAlive(chatSocket);
```

---

## 4. Chat via WebSocket

### 4.1 Send Chat Message

```typescript
chatSocket.emit('chat:send', {
  message: 'Cho tôi tư vấn size áo sơ mi phù hợp cho người cao 1m80',
  sessionId: undefined, // Leave empty to create new session, or pass existing UUID
  productId: 'product-uuid-if-asking-about-specific', // Optional
  context: { measurements: { height: 180 } }, // Optional
});
```

### 4.2 Listen for Chat Responses

```typescript
// Token chunks arrive one by one
chatSocket.on('chat:token', ({ data }) => {
  console.log(data); // "Xin ", "chào", ", bạn ..."
  appendToStreamUI(data);
});

// Stream complete
chatSocket.on('chat:done', ({ sessionId }) => {
  console.log('✓ Chat complete. Session:', sessionId);
  // Save sessionId for future messages in same conversation
});

// Error mid-stream
chatSocket.on('chat:error', ({ code, message }) => {
  console.error(`❌ Chat error [${code}]: ${message}`);
  // code: 'UNAUTHORIZED' | 'TOKEN_EXPIRED' | 'BUSY' | 'QUOTA_EXCEEDED' | ...
  showErrorToast(message);
});
```

### 4.3 Continue Conversation

To continue a past chat session, include the `sessionId`:

```typescript
chatSocket.emit('chat:send', {
  message: 'Và cỡ M có phù hợp không?',
  sessionId: 'previous-session-uuid', // ← Continue existing thread
  productId: 'product-uuid',
  context: { previousMeasurements: { height: 180, weight: 75 } },
});
```

### 4.4 Quota & Rate Limiting

Chat is rate-limited per user per day (FREE: 50, MEMBER: 200, VIP: ∞):

```typescript
// When quota exceeded:
chatSocket.on('chat:error', ({ code, message }) => {
  if (code === 'QUOTA_EXCEEDED') {
    // message: "Bạn đã dùng hết 50/50 lượt Chatbot hôm nay..."
    showUpgradePrompt();
  }
});
```

---

## 5. Disconnection & Reconnection

Socket.IO handles reconnection automatically. But listen for clean disconnection:

```typescript
realtimeSocket.on('disconnect', (reason) => {
  console.log('Disconnected:', reason);
  // reason: 'io server disconnect', 'io client namespace disconnect', 'transport close', etc.
});

realtimeSocket.on('reconnect', () => {
  console.log('✓ Reconnected');
  // Auto-joins user room again; you may want to re-fetch notifications
});

realtimeSocket.on('reconnect_failed', () => {
  console.error('❌ Failed to reconnect after max attempts. Prompt user to refresh.');
});
```

Same for `chatSocket`.

---

## 6. Migration from SSE to WebSocket

### 6.1 Old SSE Chat Endpoint (Deprecated)

The legacy SSE endpoint at `POST /api/chat` remains for backward compatibility **during transition**:

```typescript
// OLD (SSE, deprecated, will be removed ~Sept 2026)
const sse = new EventSource('/api/chat');
sse.onmessage = (e) => {
  const event = JSON.parse(e.data); // { type: 'token' | 'done', data: ... }
};
```

**Do not use this for new code.** Migrate to WebSocket chat (section 4) immediately.

### 6.2 Why Migrate?

| Feature | SSE | WebSocket |
|---------|-----|-----------|
| **Connection** | One per request | Single for all realtime |
| **Bi-directional** | ❌ (server→client only) | ✅ (both directions) |
| **Multiplexing** | ❌ (different streams) | ✅ (same socket, different events) |
| **Scalability** | Harder (sticky sessions) | ✅ (stateless via Redis) |
| **Notification support** | ❌ | ✅ (shared socket) |

---

## 7. Error Handling

### 7.1 Common Error Codes

| Code | Cause | Action |
|------|-------|--------|
| `UNAUTHORIZED` | Invalid/missing token | Re-login |
| `TOKEN_EXPIRED` | Token expired mid-stream | Refresh & reconnect |
| `USER_MISMATCH` | Token is for different user | Disconnect & re-login |
| `QUOTA_EXCEEDED` | Daily limit reached | Show upgrade prompt, try again tomorrow |
| `BUSY` (chat only) | Previous message still streaming | Wait, then retry |
| `STREAM_ERROR` | Groq API error | Retry with backoff |

### 7.2 Global Error Handler

```typescript
function setupErrorHandling(socket: Socket) {
  socket.on('error', (err) => {
    console.error('Socket error:', err);
    // Generic catch-all
  });

  socket.io.on('error', (err) => {
    console.error('Socket.IO error:', err);
  });
}

setupErrorHandling(realtimeSocket);
setupErrorHandling(chatSocket);
```

---

## 8. Full Example: React Component

```typescript
import { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

export function RealtimeChat() {
  const [messages, setMessages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const chatSocketRef = useRef<Socket | null>(null);
  const accessTokenRef = useRef(localStorage.getItem('access_token'));

  useEffect(() => {
    // Initialize chat socket (namespace '/chat' embedded in URL path)
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3002';
    chatSocketRef.current = io(`${wsUrl}/chat`, {
      transports: ['websocket'],
      reconnection: true,
      auth: { token: accessTokenRef.current },
    });

    chatSocketRef.current.on('connect', () => {
      console.log('Connected to chat');
    });

    chatSocketRef.current.on('chat:token', ({ data }) => {
      setMessages((prev) => [...prev, data]);
    });

    chatSocketRef.current.on('chat:done', ({ sessionId }) => {
      console.log('Chat done, session:', sessionId);
      setLoading(false);
    });

    chatSocketRef.current.on('chat:error', ({ code, message }) => {
      console.error(`Error [${code}]: ${message}`);
      setLoading(false);
    });

    chatSocketRef.current.on('connect_error', (error) => {
      if (error.message === 'UNAUTHORIZED') {
        console.error('Auth failed');
        // Redirect to login
      }
    });

    return () => {
      chatSocketRef.current?.disconnect();
    };
  }, []);

  const sendMessage = (msg: string) => {
    if (!chatSocketRef.current?.connected) {
      console.error('Not connected');
      return;
    }
    setMessages([]);
    setLoading(true);
    chatSocketRef.current.emit('chat:send', {
      message: msg,
      sessionId: undefined,
    });
  };

  return (
    <div>
      <div>
        {messages.map((m, i) => (
          <span key={i}>{m}</span>
        ))}
      </div>
      <button onClick={() => sendMessage('Hi')} disabled={loading}>
        Send
      </button>
    </div>
  );
}
```

---

## 9. Deployment & Rendering (Render.com)

### 9.1 Environment Setup

Render deployment uses:
- **No sticky sessions** — WebSocket must not rely on polling
- **Horizontal scaling** — Redis adapter fans out events across instances
- **Health checks** — GET `/api/health` monitors WS readiness

Backend handles this automatically. Frontend needs:

```bash
# .env.local or .env.production
NEXT_PUBLIC_API_URL=https://api.fashionai.com/api              # ← REST with /api
NEXT_PUBLIC_WS_URL=https://api.fashionai.com                  # ← WS without /api (wss:// auto-upgraded for HTTPS)
```

**For staging**:
```bash
NEXT_PUBLIC_API_URL=https://api-staging.onrender.com/api
NEXT_PUBLIC_WS_URL=https://api-staging.onrender.com
```

### 9.2 CORS

If frontend is on a different domain, CORS is pre-configured. No action needed.

---

## 10. Troubleshooting

### Issue: "Connection refused" or "connect_error"

**Cause**: Backend not running, CORS issue, or wrong URL.

**Fix**:
```typescript
// Check URL
console.log('Connecting to:', 'wss://api.yourfashionai.com');

// Check CORS origin is whitelisted
// (ask backend dev to confirm CORS_ORIGINS env var)

// Check network tab in DevTools for connection attempt
```

### Issue: "UNAUTHORIZED" on connect

**Cause**: Invalid or missing token.

**Fix**:
```typescript
const token = localStorage.getItem('access_token');
if (!token) {
  console.error('No token. Redirect to login.');
}

// Ensure token is not expired
const payload = JSON.parse(atob(token.split('.')[1]));
if (Date.now() >= payload.exp * 1000) {
  console.error('Token expired before connect.');
  // Refresh before connecting
}
```

### Issue: Chat messages not appearing

**Cause**: Not subscribed to correct events, or socket not connected.

**Fix**:
```typescript
console.log('Socket connected?', chatSocket.connected);
chatSocket.on('chat:token', (...) => ...); // Log this fires
chatSocket.emit('chat:send', { message: 'test' }); // Log this succeeds
```

### Issue: Notifications don't arrive in realtime

**Cause**: Not subscribed to `notification` event, or server bug.

**Fix**:
```typescript
realtimeSocket.on('notification', (n) => console.log('🎉', n));
// If nothing logs, check server logs: grep "notification" logs

// Verify you're in the right room
realtimeSocket.on('connect', () => {
  console.log('Rooms:', realtimeSocket.rooms); // Should include 'user:your-id'
});
```

---

## 11. Rollout Checklist for FE Team

- [ ] Install `socket.io-client` (v4+)
- [ ] Set up realtime socket in main layout/App (persist across navigation)
- [ ] Listen for `notification` events and show toast/badge
- [ ] Implement chat form with WebSocket (replace SSE endpoint)
- [ ] Handle token refresh via `token:expiring` event
- [ ] Test connection on staging (`wss://staging.yourfashionai.com`)
- [ ] Test on mobile (same websocket behavior as desktop)
- [ ] Monitor console for errors; alert backend if `chat:error` is frequent
- [ ] Remove SSE chat endpoint references (POST /api/chat) from codebase
- [ ] Update analytics: track WS connection uptime, chat message volume
- [ ] Deploy to prod **after backend deploys Phase 3 updates** (coordinate with backend)

---

## 12. Support

Questions? Contact backend team or check:
- Backend logs: `grep -i "chat\|notification\|websocket" app.log`
- Health check: `curl https://api.yourfashionai.com/health`
- Socket.IO docs: https://socket.io/docs/v4/

---

**Last Updated**: 2026-08-25 by Backend Team
