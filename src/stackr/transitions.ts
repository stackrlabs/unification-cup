import { SolidityType, Transitions } from "@stackr/sdk/machine";

import { League, LeagueState } from "./state";

export enum LogAction {
  GOAL = "GOAL",
  BLOCK = "BLOCK",
  DELETED_GOAL = "DELETED_GOAL",
  PENALTY_HIT = "PENALTY_HIT", // in case of a overtime (penalty shootout)
  PENALTY_MISS = "PENALTY_MISS", // in case of a overtime (penalty shootout)
  FOUL = "FOUL",
}

export type LeaderboardEntry = {
  won: number;
  lost: number;
  byes: number;
  points: number;
  id: number;
  name: string;
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

const getPlayerToTeam = (state: LeagueState) => {
  return state.players.reduce((acc, p) => {
    acc[p.id] = p.teamId;
    return acc;
  }, {} as Record<number, number>);
};

export const getLeaderboard = (state: LeagueState): LeaderboardEntry[] => {
  const { teams, matches, meta } = state;
  const completedMatches = matches.filter((m) => m.endTime);

  const leaderboard = teams.map((team) => ({
    ...team,
    won: 0,
    lost: 0,
    byes: 0,
    points: 0,
  }));

  // a bye is equivalent to a win so 3 points
  meta.byes.forEach((bye) => {
    const teamIndex = leaderboard.findIndex((l) => l.id === bye.teamId);
    leaderboard[teamIndex].byes += 1;
    leaderboard[teamIndex].points += 3;
  });

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
      if (a.won === b.won) {
        return a.byes - b.byes; // Sort by most byes last
      }
      return b.won - a.won; // Sort by most wins first
    }
    return b.points - a.points; // Sort by most points first
  });
};

const getTopNTeams = (state: LeagueState, n?: number) => {
  if (!n) {
    n = state.teams.length;
  }

  const leaderboard = getLeaderboard(state);
  return leaderboard.slice(0, n);
};

const getTeamsInCurrentRound = (state: LeagueState) => {
  const { meta, teams } = state;
  const totalTeams = teams.length;
  // Calculate the number of teams in the current round by halving the teams each round
  const numTeamsInCurrentRound = Math.ceil(
    totalTeams / Math.pow(2, meta.round)
  );
  const topTeams = getTopNTeams(state, numTeamsInCurrentRound);
  return topTeams;
};

const isByeRequiredInCurrentRound = (state: LeagueState): boolean => {
  const { meta } = state;

  // If the tournament has ended or not all matches are complete, return false
  if (!areAllMatchesComplete(state) || !!meta.endTime) {
    return false;
  }

  const teamsInCurrentRound = getTeamsInCurrentRound(state);

  // If only one team is left, return false
  if (teamsInCurrentRound.length === 1) {
    return false;
  }

  // If the number of remaining teams is odd, check if a bye is required
  if (teamsInCurrentRound.length % 2 !== 0) {
    const allTeamsHaveSamePoints = teamsInCurrentRound.every(
      (t, _, arr) => t.points === arr[0].points
    );

    // If all teams have the same points, return true
    if (allTeamsHaveSamePoints) {
      return true;
    }
  }

  return false;
};

const computeMatchFixtures = (state: LeagueState, blockTime: number) => {
  const { meta, teams } = state;
  // If the tournament has ended, return without scheduling matches
  if (!areAllMatchesComplete(state) || !!meta.endTime) {
    return;
  }

  const totalTeams = teams.length;
  const leaderboard = getLeaderboard(state);
  // Calculate the number of teams in the current round by halving the teams each round
  const teamsInCurrentRound = Math.ceil(totalTeams / Math.pow(2, meta.round));
  let topTeams = leaderboard.slice(0, teamsInCurrentRound);

  // If only one team is left, declare it the winner and end the tournament
  if (topTeams.length === 1) {
    state.meta.winnerTeamId = topTeams[0].id;
    state.meta.endTime = blockTime;
    return;
  }

  // If the number of top teams is odd, handle the odd team out
  if (topTeams.length % 2 !== 0) {
    const allTeamsHaveSamePoints =
      topTeams[0].points === topTeams[teamsInCurrentRound - 1].points;

    // If all teams have the same points,
    // see if we can use byes or just return without scheduling matches
    if (allTeamsHaveSamePoints) {
      const teamIdWithByeCurrentRound = meta.byes
        .filter(({ round }) => round === meta.round)
        .map(({ teamId }) => teamId)[0];
      if (teamIdWithByeCurrentRound === undefined) {
        return;
      }
      const nPlus1thTeam = leaderboard[teamsInCurrentRound];
      if (nPlus1thTeam.id === teamIdWithByeCurrentRound) {
        topTeams.push(nPlus1thTeam);
      }
    } else {
      const oneTeamHasHigherPoints =
        topTeams[0].points > topTeams[1].points &&
        topTeams[0].points > topTeams[2].points;

      // Remove the team with the highest points to ensure competitive balance
      // Otherwise, remove the team with the lowest points
      if (oneTeamHasHigherPoints) {
        topTeams.shift();
      } else {
        topTeams.pop();
      }
    }
  }

  // Generate match fixtures for the remaining teams
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
const startTournament = League.STF({
  schema: {
    timestamp: SolidityType.UINT, // nonce
  },
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
});

const startMatch = League.STF({
  schema: {
    matchId: SolidityType.UINT,
    timestamp: SolidityType.UINT, // nonce
  },
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
});

const penaltyShootout = League.STF({
  schema: {
    matchId: SolidityType.UINT,
    timestamp: SolidityType.UINT, // nonce
  },
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

    const [a, b] = Object.keys(match.scores);
    if (match.scores[a] !== match.scores[b]) {
      throw new Error("SCORES_NOT_EQUAL");
    }

    match.penaltyStartTime = block.timestamp;
    return state;
  },
});

const logGoal = League.STF({
  schema: {
    matchId: SolidityType.UINT,
    playerId: SolidityType.UINT,
    timestamp: SolidityType.UINT, // nonce
  },
  handler: ({ state, inputs, block }) => {
    const { matchId, playerId } = inputs;

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
});

const removeGoal = League.STF({
  schema: {
    matchId: SolidityType.UINT,
    playerId: SolidityType.UINT,
    timestamp: SolidityType.UINT, // nonce
  },
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
});

const endMatch = League.STF({
  schema: {
    matchId: SolidityType.UINT,
    timestamp: SolidityType.UINT, // nonce
  },
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
    if (teamScores[a] === teamScores[b]) {
      throw new Error("MATCH_NOT_CONCLUDED");
    }

    const winner = teamScores[a] > teamScores[b] ? a : b;
    match.winnerTeamId = +winner;
    match.endTime = block.timestamp;

    computeMatchFixtures(state, block.timestamp);
    return state;
  },
});

const logPenaltyHit = League.STF({
  schema: {
    matchId: SolidityType.UINT,
    playerId: SolidityType.UINT,
    timestamp: SolidityType.UINT, // nonce
  },
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
});

const logPenaltyMiss = League.STF({
  schema: {
    matchId: SolidityType.UINT,
    playerId: SolidityType.UINT,
    timestamp: SolidityType.UINT, // nonce
  },
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
});

const logBlock = League.STF({
  schema: {
    matchId: SolidityType.UINT,
    playerId: SolidityType.UINT,
    timestamp: SolidityType.UINT, // nonce
  },
  handler: ({ state, inputs, block }) => {
    const { matchId, playerId } = inputs;
    logPlayerAction(state, matchId, playerId, LogAction.BLOCK, block.timestamp);
    return state;
  },
});

const logFoul = League.STF({
  schema: {
    matchId: SolidityType.UINT,
    playerId: SolidityType.UINT,
    timestamp: SolidityType.UINT, // nonce
  },
  handler: ({ state, inputs, block }) => {
    const { matchId, playerId } = inputs;
    logPlayerAction(state, matchId, playerId, LogAction.FOUL, block.timestamp);
    return state;
  },
});

const logByes = League.STF({
  schema: {
    teamId: SolidityType.UINT,
    timestamp: SolidityType.UINT, // nonce
  },
  handler: ({ state, inputs, block }) => {
    const { teamId } = inputs;
    if (hasTournamentEnded(state)) {
      throw new Error("TOURNAMENT_ENDED");
    }

    // Is Bye required in the current round?
    if (!isByeRequiredInCurrentRound(state)) {
      throw new Error("BYE_NOT_REQUIRED_IN_THIS_ROUND");
    }

    // Can only give byes to teams not already in current round
    const teamsInCurrentRound = getTeamsInCurrentRound(state);
    if (teamsInCurrentRound.map(({ id }) => id).includes(teamId)) {
      throw new Error("TEAM_NOT_ELIGIBLE_FOR_BYE");
    }

    state.meta.byes.push({ teamId, round: state.meta.round });
    computeMatchFixtures(state, block.timestamp);
    return state;
  },
});

const addPlayer = League.STF({
  schema: {
    teamId: SolidityType.UINT,
    playerName: SolidityType.STRING,
    timestamp: SolidityType.UINT, // nonce
  },
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
});

const removePlayer = League.STF({
  schema: {
    teamId: SolidityType.UINT,
    playerId: SolidityType.UINT,
    timestamp: SolidityType.UINT, // nonce
  },
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
});

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
