import { State } from "@stackr/sdk/machine";
import { keccak256, solidityPacked } from "ethers";
import { createMMR, createMT } from "./utils";

type TournamentMeta = {
  round: number;
  startTime: number;
  endTime: number;
  winnerTeamId: number;
};

type Team = {
  id: number;
  name: string;
  captainId: number;
};

type Match = {
  id: number;
  scores: Record<string, number>;
  startTime: number;
  endTime: number;
};

type Player = {
  id: number;
  name: string;
  teamId: number;
};

type Logs = {
  playerId: number;
  matchId?: number;
  timestamp: number;
  action: string;
};

export type LeagueState = {
  meta: TournamentMeta;
  teams: Team[];
  matches: Match[];
  players: Player[];
  logs: Logs[];
};

export class League extends State<LeagueState> {
  constructor(state: LeagueState) {
    super(state);
  }

  getRootHash(): string {
    const teamsMMR = createMMR(this.state.teams, (t) =>
      solidityPacked(
        ["uint256", "string", "uint256"],
        [t.id, t.name, t.captainId]
      )
    );

    const playersMMR = createMMR(this.state.players, (p) =>
      solidityPacked(["uint256", "string", "uint256"], [p.id, p.name, p.teamId])
    );

    const matchesMMR = createMMR(this.state.matches, (m) => {
      const teamIds = Object.keys(m.scores).map((k) => parseInt(k));
      const scores = teamIds.map((id) => m.scores[id]);
      return solidityPacked(
        [
          "uint256",
          "uint256",
          "uint256",
          "uint256",
          "uint256",
          "uint256",
          "uint256",
        ],
        [
          m.id,
          teamIds[0] || 0,
          teamIds[1] || 0,
          scores[0] || 0,
          scores[1] || 0,
          m.startTime || 0,
          m.endTime || 0,
        ]
      );
    });

    const logsMMR = createMMR(this.state.logs, (l) =>
      solidityPacked(
        ["uint256", "uint256", "string", "uint256"],
        [l.playerId, l.timestamp, l.action, l.matchId || 0]
      )
    );

    const metaHash = keccak256(
      solidityPacked(
        ["uint256", "uint256", "uint256", "uint256"],
        Object.values(this.state.meta).map((v) => v || 0)
      )
    );

    const finalMerkleTree = createMT([
      metaHash,
      teamsMMR.rootHash,
      matchesMMR.rootHash,
      playersMMR.rootHash,
      logsMMR.rootHash,
    ]);

    return finalMerkleTree.rootHash;
  }
}
