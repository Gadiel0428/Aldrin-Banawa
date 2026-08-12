/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import http from "http";
import path from "path";
import fs from "fs";
import { WebSocketServer, WebSocket } from "ws";

// Load initial mock data to seed the server-authoritative state
import { 
  INITIAL_STOCK, 
  INITIAL_RECEIVING, 
  INITIAL_RETURNS, 
  INITIAL_RECYCLING, 
  INITIAL_ISSUANCE, 
  INITIAL_DELIVERIES, 
  INITIAL_ENV_LOGS, 
  INITIAL_FORKLIFT_CHECKS 
} from "./src/data";

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const PORT = 3000;

  const defaultSuperAdmin = { 
    username: 'ALDRIN BANAWA', 
    role: 'SUPER ADMINISTRATOR', 
    employeeId: 'JPMP-002', 
    permission: 'FULL_ACCESS', 
    pin: '0423' 
  };

  // Server-authoritative in-memory state
  const state = {
    stocks: [...INITIAL_STOCK],
    receiving: [...INITIAL_RECEIVING],
    returns: [...INITIAL_RETURNS],
    recycling: [...INITIAL_RECYCLING],
    issuances: [...INITIAL_ISSUANCE],
    deliveries: [...INITIAL_DELIVERIES],
    envLogs: [...INITIAL_ENV_LOGS],
    forkliftChecks: [...INITIAL_FORKLIFT_CHECKS],
    registries: [],
    registeredUsers: [defaultSuperAdmin],
  };

  interface ChatMessage {
    id: string;
    sender: string;
    text: string;
    timestamp: string;
    isSystem: boolean;
  }

  // Active chat and audit log
  const chatMessages: ChatMessage[] = [
    {
      id: "sys-init",
      sender: "System",
      text: "JUWEI WAREHOUSE MANAGEMENT SYSTEM ISO 9001:2015 Real-time Database Initialized.",
      timestamp: new Date().toISOString(),
      isSystem: true,
    }
  ];

  // Disk Persistence File
  const DATA_FILE = path.join(process.cwd(), "data-store.json");

  function loadStateFromDisk() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed && parsed.state && typeof parsed.state === "object") {
          Object.keys(parsed.state).forEach((key) => {
            if (key in state && Array.isArray(parsed.state[key])) {
              (state as any)[key] = parsed.state[key];
            }
          });
        }
        if (parsed && Array.isArray(parsed.chatMessages)) {
          chatMessages.length = 0;
          chatMessages.push(...parsed.chatMessages);
        }
        console.log("JUWEI WMS: Loaded persisted database state from disk.");
      }
    } catch (err) {
      console.error("JUWEI WMS: Error loading data-store.json:", err);
    }
  }

  function saveStateToDisk() {
    try {
      const payload = JSON.stringify({ state, chatMessages }, null, 2);
      fs.writeFileSync(DATA_FILE, payload, "utf-8");
    } catch (err) {
      console.error("JUWEI WMS: Error saving data-store.json:", err);
    }
  }

  // Load existing persisted data on startup
  loadStateFromDisk();

  // Middleware for JSON parsing and CORS
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });

  // Active connections tracker
  const activeConnections = new Map<WebSocket, string>();

  // Helper to get array of all active users
  function getActiveUsersList(): string[] {
    const users = Array.from(activeConnections.values()).filter(Boolean);
    return Array.from(new Set(users));
  }

  // API health endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", clientsCount: activeConnections.size, timestamp: new Date().toISOString() });
  });

  // API full state sync endpoint for HTTP clients / fallback
  app.get("/api/sync", (req, res) => {
    res.json({
      status: "ok",
      data: {
        ...state,
        chatMessages
      },
      activeUsers: getActiveUsersList()
    });
  });

  // API update collection endpoint for HTTP clients / fallback
  app.post("/api/sync", (req, res) => {
    try {
      const { collection, data } = req.body;
      if (collection === "chatMessages" && Array.isArray(data)) {
        chatMessages.length = 0;
        chatMessages.push(...data);
        saveStateToDisk();
        broadcast({ type: "chat_broadcast_all", messages: chatMessages });
        return res.json({ success: true, collection });
      }
      if (collection && collection in state) {
        (state as any)[collection] = data;
        saveStateToDisk();
        
        // Broadcast change to all connected WebSockets
        broadcast({
          type: "collection_updated",
          collection,
          data
        });

        return res.json({ success: true, collection, updatedCount: Array.isArray(data) ? data.length : 1 });
      }
      res.status(400).json({ error: "Invalid collection" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // REST chat and activity logging endpoint
  app.post("/api/chat", (req, res) => {
    try {
      const { username, text, isSystem } = req.body;
      if (!text) return res.status(400).json({ error: "Text required" });

      const newMsg: ChatMessage = {
        id: `${isSystem ? 'sys' : 'msg'}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        sender: username || (isSystem ? "System Audit" : "Staff"),
        text,
        timestamp: new Date().toISOString(),
        isSystem: !!isSystem
      };

      chatMessages.push(newMsg);
      if (chatMessages.length > 100) chatMessages.shift();
      saveStateToDisk();

      broadcast({
        type: "chat_broadcast",
        message: newMsg
      });

      res.json({ success: true, message: newMsg });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // API proxy endpoint to bypass browser Mixed Content restrictions when syncing across IPs
  app.post("/api/proxy-sync", async (req, res) => {
    try {
      const { targetUrl, body } = req.body;
      if (!targetUrl || typeof targetUrl !== "string") {
        return res.status(400).json({ error: "Target URL required" });
      }
      const remoteRes = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await remoteRes.json();
      res.json(data);
    } catch (err: any) {
      res.status(502).json({ error: "Proxy sync failed: " + err.message });
    }
  });

  // Attach WebSocket server on explicit /ws path
  const wss = new WebSocketServer({ server, path: "/ws" });

  // Helper to broadcast messages to all connected clients
  function broadcast(msg: any, excludeSocket?: WebSocket) {
    const rawMsg = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN && client !== excludeSocket) {
        client.send(rawMsg);
      }
    }
  }

  wss.on("connection", (ws) => {
    console.log("New WebSocket client connected");

    ws.on("message", (messageData) => {
      try {
        const payload = JSON.parse(messageData.toString());

        switch (payload.type) {
          case "ping": {
            ws.send(JSON.stringify({ type: "pong" }));
            break;
          }

          case "join": {
            const username = payload.username || "Anonymous Officer";
            activeConnections.set(ws, username);
            
            // Send initial complete state to the newly connected client
            ws.send(JSON.stringify({
              type: "init",
              data: {
                ...state,
                chatMessages
              },
              activeUsers: getActiveUsersList()
            }));

            // Notify others
            broadcast({
              type: "presence_updated",
              activeUsers: getActiveUsersList()
            });

            // Log user join in chat log
            const joinMsg: ChatMessage = {
              id: `sys-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
              sender: "System",
              text: `${username} has connected to the active session.`,
              timestamp: new Date().toISOString(),
              isSystem: true
            };
            chatMessages.push(joinMsg);
            if (chatMessages.length > 100) chatMessages.shift();
            broadcast({ type: "chat_broadcast", message: joinMsg });
            break;
          }

          case "update_collection": {
            const { collection, data } = payload;
            if (collection in state) {
              (state as any)[collection] = data;
              saveStateToDisk();
              
              // Broadcast the updated collection to all other clients
              broadcast({
                type: "collection_updated",
                collection,
                data
              }, ws);
            }
            break;
          }

          case "chat": {
            const newMsg: ChatMessage = {
              id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
              sender: payload.username || "Staff",
              text: payload.text,
              timestamp: new Date().toISOString(),
              isSystem: false
            };
            chatMessages.push(newMsg);
            if (chatMessages.length > 100) chatMessages.shift();
            saveStateToDisk();
            
            broadcast({
              type: "chat_broadcast",
              message: newMsg
            });
            break;
          }

          case "system_activity": {
            const newMsg: ChatMessage = {
              id: `sys-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
              sender: "System Audit",
              text: payload.text,
              timestamp: new Date().toISOString(),
              isSystem: true
            };
            chatMessages.push(newMsg);
            if (chatMessages.length > 100) chatMessages.shift();
            saveStateToDisk();
            
            broadcast({
              type: "chat_broadcast",
              message: newMsg
            });
            break;
          }
        }
      } catch (err) {
        console.error("Failed processing socket message", err);
      }
    });

    ws.on("close", () => {
      const username = activeConnections.get(ws);
      if (username) {
        activeConnections.delete(ws);
        
        // Notify others
        broadcast({
          type: "presence_updated",
          activeUsers: getActiveUsersList()
        });

        // Log disconnect
        const leaveMsg: ChatMessage = {
          id: `sys-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          sender: "System",
          text: `${username} has disconnected.`,
          timestamp: new Date().toISOString(),
          isSystem: true
        };
        chatMessages.push(leaveMsg);
        if (chatMessages.length > 100) chatMessages.shift();
        broadcast({ type: "chat_broadcast", message: leaveMsg });
      }
    });
  });

  // Vite middleware for development or Static Assets for production
  if (process.env.NODE_ENV !== "production") {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (e) {
      console.warn("Vite middleware omitted or unavailable:", e);
    }
  } else {
    // In production build, dist files sit either in __dirname or process.cwd()/dist
    let distPath = __dirname;
    if (!fs.existsSync(path.join(distPath, "index.html"))) {
      distPath = path.join(process.cwd(), "dist");
    }
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`JUWEI WMS Server: Port ${PORT} already in use by active WMS service.`);
    } else {
      console.error("JUWEI WMS Server error:", err);
    }
  });

  // Use PORT 3000 (Required by container infrastructure)
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`JUWEI WAREHOUSE MANAGEMENT SYSTEM Real-Time Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
