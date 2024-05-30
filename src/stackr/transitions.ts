import { STF, Transitions } from "@stackr/sdk/machine";
import { League, LeagueState } from "./state";

export enum LogAction {
  GOAL = "GOAL",
}

type MatchRequest = {
  id: number;
};

type GoalRequest = {
  matchId: number;
  playerId: number;
};

const areAllMatchesComplete = (state: LeagueState) => {
  return state.matches.every((m) => m.endTime);
};

const hasTournamentEnded = (state: LeagueState) => {
  return state.meta.winnerTeamId !== 0 && state.meta.endTime !== 0;
};

export const getPointsByTeam = (state: LeagueState) => {
  const { matches } = state;
  const completedMatches = matches.filter((m) => m.endTime);

  if (completedMatches.length === 0) {
    return state.teams.reduce((acc, team) => {
      acc[team.id] = 0;
      return acc;
    }, {} as Record<string, number>);
  }

  return completedMatches.reduce((acc, match) => {
    const [a, b] = Object.keys(match.scores);
    acc[a] = acc[a] || 0;
    acc[b] = acc[b] || 0;

    const diff = Math.abs(match.scores[a] - match.scores[b]);
    if (diff === 0) {
      acc[a] += 1;
      acc[b] += 1;
      return acc;
    }

    const winner = match.scores[a] > match.scores[b] ? a : b;
    acc[winner] = acc[winner] + 2;
    // + diff * 0.1;

    return acc;
  }, {} as Record<string, number>);
};

const getTopNTeams = (state: LeagueState, n?: number) => {
  if (!n) {
    n = state.teams.length;
  }

  const teamByPoints = getPointsByTeam(state);
  return Object.keys(teamByPoints)
    .sort((a, b) => teamByPoints[b] - teamByPoints[a])
    .slice(0, n);
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
    state.meta.winnerTeamId = parseInt(topTeams[0]);
    state.meta.endTime = blockTime;
    return;
  }

  for (let i = 0; i < topTeams.length; i += 2) {
    const team1 = topTeams[i];
    const team2 = topTeams[i + 1];
    state.matches.push({
      id: state.matches.length + 1,
      scores: { [team1]: 0, [team2]: 0 },
      startTime: 0,
      endTime: 0,
    });
  }
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
    const { id } = inputs;
    const match = state.matches.find((m) => m.id === id);
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
    if (hasTournamentEnded(state)) {
      throw new Error("TOURNAMENT_ENDED");
    }

    const { matchId, playerId } = inputs;
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

const endMatch: STF<League, MatchRequest> = {
  handler: ({ state, inputs, block }) => {
    if (hasTournamentEnded(state)) {
      throw new Error("TOURNAMENT_ENDED");
    }

    const { id } = inputs;
    const match = state.matches.find((m) => m.id === id);
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

export const transitions: Transitions<League> = {
  startMatch,
  endMatch,
  recordGoal,
  startTournament,
};
