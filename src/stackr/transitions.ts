import { STF, Transitions } from "@stackr/sdk/machine";
import { League, LeagueState } from "./state";

export enum LogAction {
  GOAL = "GOAL",
  DELETED_GOAL = "DELETED_GOAL",
  PENALTY_HIT = "PENALTY_HIT", // in case of a overtime (penalty shootout)
  PENALTY_MISS = "PENALTY_MISS", // in case of a overtime (penalty shootout)
  GOAL_SAVED = "GOAL_SAVED",
  FOUL = "FOUL",
}

type MatchRequest = {
  matchId: number;
};

type TeamRequest = {
  teamId: number;
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
  // TODO: Implement this
  // return state.admins.includes(address);
  return true;
};

const areAllMatchesComplete = (state: LeagueState) => {
  return state.matches.every((m) => m.endTime);
};

const hasTournamentEnded = (state: LeagueState) => {
  return state.meta.winnerTeamId !== 0 && state.meta.endTime !== 0;
};

const getPlayerToTeam = (state: LeagueState) => {
  return state.players.reduce((acc, p) => {
    acc[p.id] = p.teamId;
    return acc;
  }, {} as Record<number, number>);
};

const getMatchwisePenalties = (state: LeagueState) => {
  const playerToTeamId = getPlayerToTeam(state);
  return state.logs
    .filter((l) => l.action === LogAction.PENALTY_HIT)
    .reduce((acc, l) => {
      if (!l.matchId) {
        return acc;
      }
      if (!acc[l.matchId]) {
        acc[l.matchId] = {};
      }

      const teamId = playerToTeamId[l.playerId];
      if (!acc[l.matchId][teamId]) {
        acc[l.matchId][teamId] = 0;
      }

      acc[l.matchId][teamId] += 1;
      return acc;
    }, {} as any);
};

export const getLeaderboard = (state: LeagueState): LeaderboardEntry[] => {
  const { teams, matches, meta } = state;
  const completedMatches = matches.filter((m) => m.endTime);

  const leaderboard = teams.map((team) => {
    return {
      ...team,
      won: 0,
      lost: 0,
      points: 0,
    };
  });

  if (meta.byes.length) {
    meta.byes.forEach((bye) => {
      const teamIndex = leaderboard.findIndex((l) => l.id === bye.teamId);
      leaderboard[teamIndex].points += 1;
    });
  }

  const matchWiseTeamWisePenalties = getMatchwisePenalties(state);
  completedMatches.forEach((match) => {
    const { scores, id } = match;
    const [a, b] = Object.keys(scores);

    const finalScores = {
      [a]: scores[a] + matchWiseTeamWisePenalties?.[id]?.[a] || 0,
      [b]: scores[b] + matchWiseTeamWisePenalties?.[id]?.[b] || 0,
    };

    const winner = finalScores[a] > finalScores[b] ? a : b;
    const loser = finalScores[a] > finalScores[b] ? b : a;

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
  return leaderboard.slice(0, n);
};

const computeMatchFixtures = (state: LeagueState, blockTime: number) => {
  const { meta, teams } = state;
  if (!areAllMatchesComplete(state) || !!meta.endTime) {
    return;
  }

  const totalTeams = teams.length;
  const teamsInCurrentRound = Math.ceil(totalTeams / Math.pow(2, meta.round));

  const topTeams = getTopNTeams(state, teamsInCurrentRound);

  if (teamsInCurrentRound === 1) {
    state.meta.winnerTeamId = topTeams[0].id;
    state.meta.endTime = blockTime;
    return;
  }

  if (teamsInCurrentRound % 2 !== 0) {
    const allTeamsHaveSamePoints =
      topTeams[0].points === topTeams[teamsInCurrentRound - 1].points;

    if (allTeamsHaveSamePoints) {
      return;
    }

    const oneTeamHasHigherPoints =
      topTeams[0].points > topTeams[1].points &&
      topTeams[0].points > topTeams[2].points;
    // plan the match the rest of even teams
    if (oneTeamHasHigherPoints) {
      topTeams.shift();
    } else {
      topTeams.pop();
    }
  }

  for (let i = 0; i < topTeams.length; i += 2) {
    const team1 = topTeams[i];
    const team2 = topTeams[i + 1];
    state.matches.push({
      id: state.matches.length + 1,
      scores: { [team1.id]: 0, [team2.id]: 0 },
      startTime: 0,
      endTime: 0,
      penaltyStartTime: 0,
    });
  }

  // Increment round
  state.meta.round += 1;
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

const startPenaltyShootout: STF<League, MatchRequest> = {
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

    if (match.penaltyStartTime) {
      throw new Error("SHOOTOUT_ALREADY_STARTED");
    }

    match.penaltyStartTime = block.timestamp;
    return state;
  },
};

const logGoal: STF<League, GoalRequest> = {
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

// const addOvertime: STF<League, MatchRequest> = {
//   handler: ({ state, inputs }) => {
//     const { matchId } = inputs;

//     const matchIndex = state.matches.findIndex((m) => m.id === matchId);
//     if (matchIndex === -1) {
//       throw new Error("MATCH_NOT_FOUND");
//     }

//     state.matches[matchIndex].hadOvertime = true;
//     return state;
//   },
// };

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

const logPenaltyHit: STF<League, GoalRequest> = {
  handler: ({ state, inputs, block }) => {
    const { matchId, playerId } = inputs;

    const { match } = getValidMatchAndTeam(state, matchId, playerId);
    if (!match.penaltyStartTime) {
      throw new Error("PENALTY_NOT_STARTED");
    }

    state.logs.push({
      playerId,
      matchId,
      timestamp: block.timestamp,
      action: LogAction.PENALTY_HIT,
    });

    return state;
  },
};

const logPenaltyMiss: STF<League, GoalRequest> = {
  handler: ({ state, inputs, block }) => {
    const { matchId, playerId } = inputs;

    const { match } = getValidMatchAndTeam(state, matchId, playerId);
    if (!match.penaltyStartTime) {
      throw new Error("PENALTY_NOT_STARTED");
    }

    state.logs.push({
      playerId,
      matchId,
      timestamp: block.timestamp,
      action: LogAction.PENALTY_MISS,
    });

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

const logByes: STF<League, TeamRequest> = {
  handler: ({ state, inputs, block }) => {
    const { teamId } = inputs;
    state.meta.byes.push({ teamId, round: state.meta.round });
    computeMatchFixtures(state, block.timestamp);
    return state;
  },
};

export const transitions: Transitions<League> = {
  startMatch,
  startPenaltyShootout,
  endMatch,
  logGoal,
  removeGoal,
  startTournament,
  logByes,
  logPenaltyHit,
  logPenaltyMiss,
  logGoalSaved,
  logFoul,
};
