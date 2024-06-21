import { STF, Transitions } from "@stackr/sdk/machine";
import { League, LeagueState } from "./state";

export enum LogAction {
  GOAL = "GOAL",
  DELETED_GOAL = "DELETED_GOAL",
  PENALTY = "PENALTY", // in case of a overtime (penalty shootout)
  GOAL_SAVED = "GOAL_SAVED",
  FOUL = "FOUL",
}

type MatchRequest = {
  matchId: number;
};

type GoalRequest = {
  matchId: number;
  playerId: number;
};

export type LeaderboardEntry = {
  won: number;
  lost: number;
  points: number;
  id: number;
  name: string;
  captainId: number;
};

export const canAddressSubmitAction = (
  state: LeagueState,
  address: string
): boolean => {
  return state.admins.includes(address);
};

const areAllMatchesComplete = (state: LeagueState) => {
  return state.matches.every((m) => m.endTime);
};

const hasTournamentEnded = (state: LeagueState) => {
  return state.meta.winnerTeamId !== 0 && state.meta.endTime !== 0;
};

export const getLeaderboard = (state: LeagueState): LeaderboardEntry[] => {
  const { teams, matches } = state;
  const completedMatches = matches.filter((m) => m.endTime);

  const leaderboard = teams.map((team) => {
    return {
      ...team,
      won: 0,
      lost: 0,
      points: 0,
    };
  });

  completedMatches.forEach((match) => {
    const { scores, hadOvertime } = match;
    const [a, b] = Object.keys(scores);
    const winner = scores[a] > scores[b] ? a : b;
    const loser = scores[a] > scores[b] ? b : a;

    const winnerIndex = leaderboard.findIndex((l) => l.id === +winner);
    const loserIndex = leaderboard.findIndex((l) => l.id === +loser);

    leaderboard[winnerIndex].won += 1;
    leaderboard[loserIndex].lost += 1;

    leaderboard[winnerIndex].points += 3;
  });

  return leaderboard.sort((a, b) => b.points - a.points);
};

const getTopNTeams = (state: LeagueState, n?: number) => {
  if (!n) {
    n = state.teams.length;
  }

  const leaderboard = getLeaderboard(state);
  return leaderboard.slice(0, n).map((l) => l.id);
};

const computeMatchFixtures = (state: LeagueState, blockTime: number) => {
  if (!areAllMatchesComplete(state)) {
    return;
  }

  // Increment round
  state.meta.round += 1;

  const { meta, teams } = state;

  const totalTeams = teams.length;
  const teamsInCurrentRound = totalTeams / Math.pow(2, meta.round - 1);

  const topTeams = getTopNTeams(state, teamsInCurrentRound);

  if (teamsInCurrentRound === 1) {
    state.meta.winnerTeamId = topTeams[0];
    state.meta.endTime = blockTime;
    return;
  }

  if (teamsInCurrentRound % 2 !== 0) {
    // TODO: Handle odd number of teams for cases like 6, 12 and so on
    throw new Error("INVALID_TEAM_COUNT");
  }

  for (let i = 0; i < topTeams.length; i += 2) {
    const team1 = topTeams[i];
    const team2 = topTeams[i + 1];
    state.matches.push({
      id: state.matches.length + 1,
      scores: { [team1]: 0, [team2]: 0 },
      startTime: 0,
      endTime: 0,
      hadOvertime: false,
    });
  }
};

const getValidMatchAndTeam = (
  state: LeagueState,
  matchId: number,
  playerId: number
) => {
  if (hasTournamentEnded(state)) {
    throw new Error("TOURNAMENT_ENDED");
  }

  const match = state.matches.find((m) => m.id === matchId);
  if (!match) {
    throw new Error("MATCH_NOT_FOUND");
  }

  if (!match.startTime) {
    throw new Error("MATCH_NOT_STARTED");
  }

  if (match.endTime) {
    throw new Error("MATCH_ENDED");
  }

  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    throw new Error("PLAYER_NOT_FOUND");
  }

  const teams = Object.keys(match.scores);
  const teamId = player.teamId;
  if (!teams.includes(String(teamId))) {
    throw new Error("INVALID_TEAM");
  }

  return { match, teamId };
};

const logPlayerAction = (
  state: LeagueState,
  matchId: number,
  playerId: number,
  action: LogAction,
  timestamp: number
) => {
  getValidMatchAndTeam(state, matchId, playerId);

  state.logs.push({
    playerId,
    matchId,
    timestamp,
    action,
  });
};

// State Transition Functions
const startTournament: STF<League, MatchRequest> = {
  handler: ({ state, block }) => {
    if (hasTournamentEnded(state)) {
      throw new Error("TOURNAMENT_ALREADY_ENDED");
    }

    if (state.meta.round !== 0) {
      throw new Error("TOURNAMENT_ALREADY_STARTED");
    }

    computeMatchFixtures(state, block.timestamp);
    state.meta.startTime = block.timestamp;
    return state;
  },
};

const startMatch: STF<League, MatchRequest> = {
  handler: ({ state, inputs, block }) => {
    if (hasTournamentEnded(state)) {
      throw new Error("TOURNAMENT_ENDED");
    }
    const { matchId } = inputs;
    const match = state.matches.find((m) => m.id === matchId);
    if (!match) {
      throw new Error("MATCH_NOT_FOUND");
    }

    if (match.startTime) {
      throw new Error("MATCH_ALREADY_STARTED");
    }

    match.startTime = block.timestamp;
    return state;
  },
};

const recordGoal: STF<League, GoalRequest> = {
  handler: ({ state, inputs, block }) => {
    const { matchId, playerId } = inputs;
    if (hasTournamentEnded(state)) {
      throw new Error("TOURNAMENT_ENDED");
    }

    const { match, teamId } = getValidMatchAndTeam(state, matchId, playerId);

    match.scores[teamId] += 1;
    state.logs.push({
      playerId,
      matchId,
      timestamp: block.timestamp,
      action: LogAction.GOAL,
    });

    return state;
  },
};

const removeGoal: STF<League, GoalRequest> = {
  handler: ({ state, inputs, block }) => {
    const { matchId, playerId } = inputs;
    const { match, teamId } = getValidMatchAndTeam(state, matchId, playerId);

    match.scores[teamId] -= 1;

    // TODO: do we want visibility here? or we can simply remove the last logged goal with this playerId and matchId
    state.logs.push({
      playerId,
      matchId,
      timestamp: block.timestamp,
      action: LogAction.DELETED_GOAL,
    });

    return state;
  },
};

const addOvertime: STF<League, MatchRequest> = {
  handler: ({ state, inputs }) => {
    const { matchId } = inputs;

    const matchIndex = state.matches.findIndex((m) => m.id === matchId);
    if (matchIndex === -1) {
      throw new Error("MATCH_NOT_FOUND");
    }

    state.matches[matchIndex].hadOvertime = true;
    return state;
  },
};

const endMatch: STF<League, MatchRequest> = {
  handler: ({ state, inputs, block }) => {
    if (hasTournamentEnded(state)) {
      throw new Error("TOURNAMENT_ENDED");
    }

    const { matchId } = inputs;
    const match = state.matches.find((m) => m.id === matchId);
    if (!match) {
      throw new Error("MATCH_NOT_FOUND");
    }

    if (!match.startTime) {
      throw new Error("MATCH_NOT_STARTED");
    }

    if (match.endTime) {
      throw new Error("MATCH_ALREADY_ENDED");
    }

    match.endTime = block.timestamp;
    computeMatchFixtures(state, block.timestamp);
    return state;
  },
};

const logPenalty: STF<League, GoalRequest> = {
  handler: ({ state, inputs, block }) => {
    const { matchId, playerId } = inputs;
    logPlayerAction(
      state,
      matchId,
      playerId,
      LogAction.PENALTY,
      block.timestamp
    );

    return state;
  },
};

const logGoalSaved: STF<League, GoalRequest> = {
  handler: ({ state, inputs, block }) => {
    const { matchId, playerId } = inputs;
    logPlayerAction(
      state,
      matchId,
      playerId,
      LogAction.GOAL_SAVED,
      block.timestamp
    );
    return state;
  },
};

const logFoul: STF<League, GoalRequest> = {
  handler: ({ state, inputs, block }) => {
    const { matchId, playerId } = inputs;
    logPlayerAction(state, matchId, playerId, LogAction.FOUL, block.timestamp);
    return state;
  },
};

export const transitions: Transitions<League> = {
  startMatch,
  endMatch,
  recordGoal,
  removeGoal,
  startTournament,
  addOvertime,
  logPenalty,
  logGoalSaved,
  logFoul,
};
