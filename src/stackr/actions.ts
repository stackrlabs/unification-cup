import { ActionSchema, SolidityType } from "@stackr/sdk";

const baseTimeStamp = {
  timestamp: SolidityType.UINT,
};

const startTournamentSchema = new ActionSchema("startTournament", {
  ...baseTimeStamp,
});

const startMatchSchema = new ActionSchema("startMatch", {
  id: SolidityType.UINT,
  ...baseTimeStamp,
});

const endMatchSchema = new ActionSchema("endMatch", {
  id: SolidityType.UINT,
  ...baseTimeStamp,
});

const recordGoalSchema = new ActionSchema("recordGoal", {
  matchId: SolidityType.UINT,
  playerId: SolidityType.UINT,
  ...baseTimeStamp,
});

export const schemas = {
  startMatch: startMatchSchema,
  endMatch: endMatchSchema,
  recordGoal: recordGoalSchema,
  startTournament: startTournamentSchema,
};
