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

export const schemas = {
  startMatch: matchAction,
  addOvertime: matchAction,
  endMatch: matchAction,
  recordGoal: matchPlayerAction,
  startTournament: startTournamentSchema,
};
