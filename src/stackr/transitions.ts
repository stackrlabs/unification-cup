import { STF, Transitions } from "@stackr/sdk/machine";
import { League, LeagueState } from "./state";

export enum LogAction {
  GOAL = "GOAL",
  BLOCK = "BLOCK",
  DELETED_GOAL = "DELETED_GOAL",
  PENALTY_HIT = "PENALTY_HIT", // in case of a overtime (penalty shootout)
  PENALTY_MISS = "PENALTY_MISS", // in case of a overtime (penalty shootout)
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

  completedMatches.forEach((match) => {
    const { winnerTeamId, scores } = match;
    const loserTeamId = Object.keys(scores).find((k) => +k !== winnerTeamId);
    if (!loserTeamId) {
      return;
    }

    const winnerIndex = leaderboard.findIndex((l) => l.id === +winnerTeamId);
    const loserIndex = leaderboard.findIndex((l) => l.id === +loserTeamId);

    leaderboard[winnerIndex].won += 1;
    leaderboard[loserIndex].lost += 1;

    leaderboard[winnerIndex].points += 3;
  });

  return leaderboard.sort((a, b) => {
    if (a.points === b.points) {
      return a.won - b.won;
    }
    return b.points - a.points;
  });
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

  // this is assuming that the bye will be given to the team with lower score, and they'll get a chance to play with the top 3 teams
  const shouldIncludeOneBye =
    teamsInCurrentRound !== 1 &&
    teamsInCurrentRound % 2 === 1 &&
    meta.byes.length === 1
      ? 1
      : 0;

  const topTeams = getTopNTeams(
    state,
    teamsInCurrentRound + shouldIncludeOneBye
  );

  if (topTeams.length === 1) {
    state.meta.winnerTeamId = topTeams[0].id;
    state.meta.endTime = blockTime;
    return;
  }

  if (topTeams.length % 2 !== 0) {
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
      winnerTeamId: 0,
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

const penaltyShootout: STF<League, MatchRequest> = {
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
    if (match.scores[teamId] === 0) {
      throw new Error("NO_GOALS_TO_REMOVE");
    }
    const correspondingGoalIdx = state.logs.findIndex(
      (l) =>
        l.matchId === matchId &&
        l.playerId === playerId &&
        l.action === LogAction.GOAL
    );

    if (correspondingGoalIdx === -1) {
      throw new Error("NO_GOALS_TO_REMOVE");
    }

    match.scores[teamId] -= 1;
    state.logs.push({
      playerId,
      matchId,
      timestamp: block.timestamp,
      action: LogAction.DELETED_GOAL,
    });

    return state;
  },
};

const endMatch: STF<League, MatchRequest> = {
  handler: ({ state, inputs, block }) => {
    if (hasTournamentEnded(state)) {
      throw new Error("TOURNAMENT_ENDED");
    }

    const { matchId } = inputs;
    const { matches, logs } = state;
    const match = matches.find((m) => m.id === matchId);
    if (!match) {
      throw new Error("MATCH_NOT_FOUND");
    }

    if (!match.startTime) {
      throw new Error("MATCH_NOT_STARTED");
    }

    if (match.endTime) {
      throw new Error("MATCH_ALREADY_ENDED");
    }

    const teamScores = { ...match.scores };

    if (match.penaltyStartTime) {
      const playerIdToTeamId = getPlayerToTeam(state);

      const penalties = logs.filter(
        (l) => l.matchId === matchId && l.action === LogAction.PENALTY_HIT
      );

      for (const penalty of penalties) {
        const teamId = playerIdToTeamId[penalty.playerId];
        teamScores[teamId] += 1;
      }
    }

    const [a, b] = Object.keys(teamScores);
    const winner = teamScores[a] > teamScores[b] ? a : b;
    match.winnerTeamId = +winner;
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

const logBlock: STF<League, GoalRequest> = {
  handler: ({ state, inputs, block }) => {
    const { matchId, playerId } = inputs;
    logPlayerAction(state, matchId, playerId, LogAction.BLOCK, block.timestamp);
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

const addPlayer: STF<League, { teamId: number; playerName: string }> = {
  handler: ({ state, inputs }) => {
    const { logs } = state;
    const { teamId, playerName } = inputs;
    const maxPlayerIdFromLogs = logs.reduce((acc, l) => {
      if (l.playerId > acc) {
        return l.playerId;
      }
      return acc;
    }, 0);

    const lastMaxId = Math.max(
      state.players.at(-1)?.id || 0,
      state.players.length,
      maxPlayerIdFromLogs
    );

    state.players.push({
      id: lastMaxId + 1,
      name: playerName,
      teamId,
    });

    return state;
  },
};

const removePlayer: STF<League, { teamId: number; playerId: number }> = {
  handler: ({ state, inputs, block }) => {
    const { teamId, playerId } = inputs;
    const player = state.players.find((p) => p.id === playerId);
    if (!player) {
      throw new Error("PLAYER_NOT_FOUND");
    }

    if (player.teamId !== teamId) {
      throw new Error("INVALID_TEAM");
    }

    player.removedAt = block.timestamp;
    return state;
  },
};

export const transitions: Transitions<League> = {
  startMatch,
  penaltyShootout,
  endMatch,
  logGoal,
  removeGoal,
  startTournament,
  logByes,
  logBlock,
  logFoul,
  logPenaltyHit,
  logPenaltyMiss,
  addPlayer,
  removePlayer,
};
