import * as fs from "fs";
import * as path from "path";
import { createServer } from "http";
import WebSocket, { WebSocketServer } from "ws";
import {
  Room,
  WebSocketMessage,
  Player,
  Ship,
} from "../websocket_server/types";
import { v4 as uuidv4 } from "uuid";

export const HTTP_PORT = 3000;

export const httpServer = createServer(function (req, res) {
  const __dirname = path.resolve(path.dirname(""));
  const file_path =
    __dirname + (req.url === "/" ? "/front/index.html" : "/front" + req.url);
  fs.readFile(file_path, function (err, data) {
    if (err) {
      res.writeHead(404);
      res.end(JSON.stringify(err));
      return;
    }
    res.writeHead(200);
    res.end(data);
  });
});

httpServer.listen(HTTP_PORT);
console.log(`Static HTTP server started on port ${HTTP_PORT}`);
const wsServer = new WebSocketServer({ server: httpServer });
console.log(`WebSocket server listening on ws://localhost:${HTTP_PORT}`);

// In-memory data stores
const players = new Map<
  string,
  { name: string; password: string; wins: number }
>();
const rooms = new Map<string, Room>();

function broadcast(data: string) {
  wsServer.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

wsServer.on("connection", (ws) => {
  console.log("New WebSocket connection");

  ws.on("message", (message: string) => {
    const msg: WebSocketMessage = JSON.parse(message);
    console.log("Received:", msg);

    switch (msg.type) {
      case "reg":
        handlePlayerRegistration(ws, msg);
        break;
      case "create_room":
        handleCreateRoom(ws, msg);
        break;
      case "add_user_to_room":
        handleJoinRoom(ws, msg);
        break;
      case "add_ships":
        handleAddShips(ws, msg);
        break;
      case "attack":
        handleAttack(ws, msg);
        break;
      // case "randomAttack":
      //   randomAttack(ws, msg);
      //   break;
      default:
        console.log(`Unknown message type: ${msg.type}`);
    }
  });

  ws.on("close", () => {
    console.log("WebSocket connection closed");
  });
});

function handlePlayerRegistration(ws: WebSocket, msg: WebSocketMessage) {
  const data = typeof msg.data === "string" ? JSON.parse(msg.data) : msg.data;
  const { name, password } = data;
  const existingPlayer = Array.from(players.values()).find(
    (player) => player.name === name
  );

  let response;
  if (existingPlayer) {
    if (existingPlayer.password === password) {
      response = {
        type: "reg",
        data: { name, index: uuidv4(), error: false, errorText: "" },
        id: 0,
      };
    } else {
      response = {
        type: "reg",
        data: JSON.stringify({
          name,
          index: null,
          error: true,
          errorText: "Incorrect password",
        }),
        id: 0,
      };
    }
  } else {
    const playerId = uuidv4();
    players.set(playerId, { name, password, wins: 0 });
    response = {
      type: "reg",
      data: JSON.stringify({
        name,
        index: playerId,
        error: false,
        errorText: "",
      }),
      id: 0,
    };
  }

  ws.send(JSON.stringify(response));
  updateWinnersTable();
  updateRoomList();
}

function updateWinnersTable() {
  const winners = Array.from(players.values()).map((player) => ({
    name: player.name,
    wins: player.wins,
  }));

  const response = {
    type: "update_winners",
    data: JSON.stringify(winners),
    id: 0,
  };

  broadcast(JSON.stringify(response));
}

function handleCreateRoom(ws: WebSocket, msg: WebSocketMessage) {
  const playerId = uuidv4();
  const roomId = uuidv4();
  const player: Player = { id: playerId, ws, name: "" };

  rooms.set(roomId, { roomId, players: [player], gameStarted: false });
  ws.send(
    JSON.stringify({
      type: "create_game",
      data: JSON.stringify({ idGame: roomId, idPlayer: playerId }),
      id: 0,
    })
  );

  updateRoomList();
}

function handleJoinRoom(ws: WebSocket, msg: WebSocketMessage) {
  // Parse the data to retrieve the room index
  const data = typeof msg.data === "string" ? JSON.parse(msg.data) : msg.data;
  const { indexRoom } = data;
  const playerId = uuidv4(); // Generate a unique ID for the second player
  const room = rooms.get(indexRoom);

  if (room && room.players.length === 1 && !room.gameStarted) {
    // Add the second player to the room
    const player: Player = { id: playerId, ws, name: "" };
    room.players.push(player);
    room.gameStarted = true;

    room.players.forEach((p) => {
      p.ws.send(
        JSON.stringify({
          type: "add_user_to_room",
          data: JSON.stringify({ indexRoom: indexRoom }),
          id: 0,
        })
      );
    });

    // Notify both players that the game is ready to start
    room.players.forEach((p) => {
      p.ws.send(
        JSON.stringify({
          type: "create_game",
          data: JSON.stringify({ idGame: indexRoom, idPlayer: p.id }),
          id: 0,
        })
      );
    });

    // Remove the room from the available rooms and broadcast the updated room list
    updateRoomList();
  } else {
    // Send an error if the room is full or does not exist
    ws.send(
      JSON.stringify({
        type: "error",
        data: { message: "Room is full or does not exist" },
        id: 0,
      })
    );
  }
}

function updateRoomList() {
  const availableRooms = Array.from(rooms.values())
    .filter((room) => room.players.length === 1 && !room.gameStarted)
    .map((room) => ({
      roomId: room.roomId,
      roomUsers: room.players.map((player) => ({
        name: player.name,
        index: player.id,
      })),
      id: 0,
    }));

  console.log(`Update room list: ${JSON.stringify(availableRooms)}`);
  const response = {
    type: "update_room",
    data: JSON.stringify(availableRooms),
    id: 0,
  };

  broadcast(JSON.stringify(response));
}

// Gameplay: Adding Ships and Starting Game
function handleAddShips(ws: WebSocket, msg: WebSocketMessage) {
  const data = typeof msg.data === "string" ? JSON.parse(msg.data) : msg.data;
  const { gameId, ships, indexPlayer } = data;
  const room = rooms.get(gameId);

  if (!room) {
    ws.send(
      JSON.stringify({
        type: "error",
        data: { message: "Game not found" },
        id: 0,
      })
    );
    return;
  }

  const player = room.players.find((p) => p.id === indexPlayer);
  if (!player) {
    ws.send(
      JSON.stringify({
        type: "error",
        data: { message: "Player not found in the game" },
        id: 0,
      })
    );
    return;
  }

  // Store player's ships in their data
  player.ships = ships.map((ship: any) => ({
    ...ship,
    hits: 0, // Track hits for each ship part
  }));

  // Check if both players have added their ships
  if (room.players.length === 2 && room.players.every((p) => p.ships)) {
    startGame(room);
  }
}

function startGame(room: Room) {
  const [player1, player2] = room.players;

  const startMsg = {
    type: "start_game",
    data: JSON.stringify({ ships: [], currentPlayerIndex: player1.id }),
    id: 0,
  };

  player1.ws.send(JSON.stringify(startMsg));
  player2.ws.send(JSON.stringify(startMsg));
  startTurn(room);
}

function findShipAtPosition(
  ships: any[],
  position: { x: number; y: number }
): Ship {
  for (const ship of ships) {
    const occupiedPositions = getShipPositions(ship);
    if (
      occupiedPositions.some(
        (pos) => pos.x === position.x && pos.y === position.y
      )
    ) {
      return ship;
    }
  }
  return null;
}

function getShipPositions(ship: {
  position: { x: number; y: number };
  direction: boolean;
  length: number;
}) {
  const positions = [];
  for (let i = 0; i < ship.length; i++) {
    if (ship.direction !== true) {
      positions.push({ x: ship.position.x + i, y: ship.position.y });
    } else {
      positions.push({ x: ship.position.x, y: ship.position.y + i });
    }
  }
  return positions;
}

// function randomAttack(ws: WebSocket, msg: WebSocketMessage) {
//   console.log("random attack triggered");
//   const data = JSON.parse(msg.data);
//   const room = rooms.get(data.gameId);

//   ws.send(
//     JSON.stringify({
//       type: "attack",
//       data: {
//         indexPlayer: data.indexPlayer,
//         gameId: data.gameId,
//       },
//       id: 0,
//     })
//   );
// }

// Attack Handling
function handleAttack(ws: WebSocket, msg: WebSocketMessage) {
  let data = JSON.parse(msg.data);
  const room = rooms.get(data.gameId);
  if (!room) {
    ws.send(
      JSON.stringify({
        type: "error",
        data: JSON.stringify({ message: "Game not found" }),
        id: 0,
      })
    );
    return;
  }

  const attacker = room.players.find((p) => p.id === data.indexPlayer);
  const opponent = room.players.find((p) => p.id !== data.indexPlayer);
  if (!attacker || !opponent) {
    ws.send(
      JSON.stringify({
        type: "error",
        data: { message: "Player not found in the game" },
        id: 0,
      })
    );
    return;
  }
  // Use findShipAtPosition to determine if the attack hits any of the opponent's ships
  const attackedPosition = { x: data.x, y: data.y };
  const shipHit = findShipAtPosition(opponent.ships, attackedPosition);

  let hitStatus = "miss";

  if (shipHit) {
    hitStatus = shipHit.type === "small" ? "killed" : "shot";
  }

  const response = {
    type: "attack",
    data: JSON.stringify({
      position: attackedPosition,
      currentPlayer: data.indexPlayer,
      status: hitStatus,
    }),
    id: 0,
  };
  // Send attack result to both players
  // broadcast(JSON.stringify(response));
  room.players.forEach((player) => player.ws.send(JSON.stringify(response)));

  // Check if all opponent's ships are killed
  // const isGameFinished =
  //   hitStatus === "killed" && checkIfAllShipsSunk(opponent.ships);
  // if (isGameFinished) {
  //   finishGame(room, data.indexPlayer); // End the game if all ships are sunk
  // } else {
  //   // Update turn if the game is not finished
  //   startTurn(room);
  // }
  startTurn(room);
}

// Function to check if all ships are sunk (placeholder)
// function checkIfAllShipsSunk(ships: Ship[]): boolean {
//   return ships.every((ship) => ship.hits === ship.length);
// }

// Function to finish the game and notify players
function finishGame(room: Room, winnerId: string) {
  const response = {
    type: "finish",
    data: {
      winPlayer: winnerId,
    },
    id: 0,
  };

  // Notify all players in the room of the game finish
  room.players.forEach((player) => player.ws.send(JSON.stringify(response)));

  // Update the winner's record
  const winner = players.get(winnerId);
  if (winner) {
    winner.wins += 1;
  }

  // Update winners table test
  updateWinnersTable();
}

// Function to start the next turn
function startTurn(room: Room) {
  // Determine the next player (alternates turns)
  const currentPlayerIndex = room.players.findIndex(
    (player) => player.id === room.players[0].id
  );
  const nextPlayer =
    room.players[(currentPlayerIndex + 1) % room.players.length];

  const turnMessage = {
    type: "turn",
    data: JSON.stringify({
      currentPlayer: nextPlayer.id,
    }),
    id: 0,
  };

  // Notify both players whose turn it is
  room.players.forEach((player) => player.ws.send(JSON.stringify(turnMessage)));
}
