import WebSocket from "ws"; // Explicitly import from `ws`

export interface Player {
  id: string;
  ws: WebSocket;
  name: string;
  ships?: Ship[];
}

export interface Ship {
  position: { x: number; y: number };
  direction: boolean;
  length: number;
  type: "small" | "medium" | "large" | "huge";
}

export interface Room {
  roomId: string;
  players: Player[];
  gameStarted: boolean;
}

export interface WebSocketMessage {
  type: string;
  data: any;
  id: number;
}
