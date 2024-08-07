import { State } from "@stackr/sdk/machine";
import { solidityPacked, solidityPackedKeccak256 } from "ethers";
import { createMT } from "./utils";

type TournamentMeta = {
  round: number;
  startTime: number;
  endTime: number;
  winnerTeamId: number;
  byes: {
    teamId: number;
    round: number;
  }[];
};

type Team = {
  id: number;
  name: string;
};

type Match = {
  id: number;
  scores: Record<string, number>;
  startTime: number;
  endTime: number;
  penaltyStartTime: number;
  winnerTeamId: number;
};

export type Player = {
  id: number;
  name: string;
  teamId: number;
  removedAt?: number;
};

export type Logs = {
  playerId: number;
  matchId?: number;
  timestamp: number;
  action: string;
};

export type LeagueState = {
  admins: string[];
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
    const { admins, teams, players, matches, meta, logs } = this.state;
    const adminsMerkleTree = createMT(admins, (a) =>
      solidityPacked(["address"], [a])
    );

    const teamsMerkleTree = createMT(teams, (t) =>
      solidityPacked(["uint256", "string"], [t.id, t.name])
    );

    const playersMerkleTree = createMT(players, (p) =>
      solidityPacked(
        ["uint256", "string", "uint256", "uint256"],
        [p.id, p.name, p.teamId, p.removedAt || 0]
      )
    );

    const matchesMMR = createMT(matches, (m) => {
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
          m.penaltyStartTime || 0,
          m.winnerTeamId || 0,
        ]
      );
    });

    const logsMMR = createMT(logs, (l) =>
      solidityPacked(
        ["uint256", "uint256", "string", "uint256"],
        [l.playerId, l.timestamp, l.action, l.matchId || 0]
      )
    );

    const metaHash = solidityPackedKeccak256(
      ["uint256", "uint256", "uint256", "uint256", "string"],
      Object.values(meta).map((v) => {
        if (typeof v === "number") {
          return v;
        }
        return Object.entries(v)
          .map(([k, v]) => `${k}:${v}`)
          .join(",");
      })
    );

    const finalMerkleTree = createMT([
      adminsMerkleTree.rootHash,
      metaHash,
      teamsMerkleTree.rootHash,
      playersMerkleTree.rootHash,
      matchesMMR.rootHash,
      logsMMR.rootHash,
    ]);

    return finalMerkleTree.rootHash;
  }
}
