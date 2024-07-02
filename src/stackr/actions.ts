import { ActionSchema, SolidityType } from "@stackr/sdk";

const baseTimeStamp = {
  timestamp: SolidityType.UINT,
};

const startTournamentSchema = new ActionSchema("startTournament", {
  ...baseTimeStamp,
});

const matchAction = new ActionSchema("matchAction", {
  matchId: SolidityType.UINT,
  ...baseTimeStamp,
});

const matchPlayerAction = new ActionSchema("matchPlayerAction", {
  matchId: SolidityType.UINT,
  playerId: SolidityType.UINT,
  ...baseTimeStamp,
});

const teamActionSchema = new ActionSchema("teamAction", {
  teamId: SolidityType.UINT,
  ...baseTimeStamp,
});

const addPlayerSchema = new ActionSchema("addPlayer", {
  teamId: SolidityType.UINT,
  playerName: SolidityType.STRING,
  ...baseTimeStamp,
});

export const schemas = {
  startMatch: matchAction,
  endMatch: matchAction,
  logGoal: matchPlayerAction,
  startTournament: startTournamentSchema,
  logByes: teamActionSchema,
  addPlayer: addPlayerSchema,
};
