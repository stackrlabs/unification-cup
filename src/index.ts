import express, { Request, Response } from "express";

import dotenv from "dotenv";
import { stackrConfig } from "../stackr.config.ts";
import { schemas } from "./stackr/actions.ts";
import {
  leagueMachine,
  LeagueMachine,
  STATE_MACHINES,
} from "./stackr/machines.ts";
import {
  getLeaderboard,
  LeaderboardEntry,
  LogAction,
  transitions,
} from "./stackr/transitions.ts";

dotenv.config();

import { MicroRollup } from "@stackr/sdk";
import { Logs, Player } from "./stackr/state.ts";
import { signAsOperator } from "./utils.ts";

export const stfSchemaMap = {
  startMatch: schemas.startMatch,
  endMatch: schemas.endMatch,
  recordGoal: schemas.recordGoal,
  removeGoal: schemas.recordGoal,
  logPenalty: schemas.recordGoal,
  startTournament: schemas.startTournament,
  addOvertime: schemas.addOvertime,
};

const main = async () => {
  /**
   * Initialize the MicroRollup instance
   */
  const mru = await MicroRollup({
    config: stackrConfig,
    actionSchemas: Object.values(schemas),
    stateMachines: [leagueMachine],
    stfSchemaMap,
    isSandbox: process.env.NODE_ENV === "sandbox",
  });

  await mru.init();

  const app = express();
  app.use(express.json());
  // allow CORS
  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept"
    );
    next();
  });

  const machine = mru.stateMachines.get<LeagueMachine>(STATE_MACHINES.LEAGUE);

  if (!machine) {
    throw new Error("League machine not initialized yet");
  }

  const getMatchInfo = (matchId: number) => {
    const { teams, matches } = machine.state;
    const match = matches.find((m) => m.id === matchId);
    if (!match) {
      throw new Error("MATCH_NOT_FOUND");
    }
    const { scores, ...rest } = match;
    const teamsWithInfo = Object.keys(scores).map((id) => ({
      id: id,
      name: teams.find((t) => t.id === +id)?.name,
      score: scores[id],
    }));
    return {
      ...rest,
      teams: teamsWithInfo,
    };
  };

  const getPlayerInfo = (playerId: number) => {
    const { players, teams } = machine.state;
    const p = players.find((p) => p.id === playerId);
    if (!p) {
      throw new Error("PLAYER_NOT_FOUND");
    }
    const team = teams.find((t) => t.id === p?.teamId);
    if (!team) {
      throw new Error("TEAM_NOT_FOUND");
    }
    return {
      ...p,
      team: team.name,
    };
  };

  const getPlayerLeaderboard = (
    players: Player[],
    logs: Logs[],
    leaderboard: LeaderboardEntry[]
  ) => {
    const playerWiseGoals = logs.reduce((acc, log) => {
      if (!acc[log.playerId]) {
        acc[log.playerId] = 0;
      }
      if (log.action === LogAction.GOAL) {
        acc[log.playerId] += 1;
      }
      if (log.action === LogAction.DELETED_GOAL) {
        acc[log.playerId] -= 1;
      }
      return acc;
    }, {} as Record<string, number>);

    const playerWithDetails = players.map((p) => getPlayerInfo(p.id));

    const sortedPlayersWithDetails = playerWithDetails
      .map((playerInfo) => {
        const { id, teamId } = playerInfo;
        const teamPoints =
          leaderboard.find((l) => l.id === teamId)?.points || 0;
        const playerGoals = playerWiseGoals[id] || 0;
        return {
          ...playerInfo,
          goals: playerGoals,
          points: playerGoals * 10 + teamPoints * 5,
        };
      })
      .sort((a, b) => b.goals - a.goals);

    return sortedPlayersWithDetails;
  };

  /** Routes */
  app.get("/info", (_req: Request, res: Response) => {
    const transitionToSchema = mru.getStfSchemaMap();
    res.send({
      signingInstructions: "signTypedData(domain, schema.types, inputs)",
      domain: stackrConfig.domain,
      transitionToSchema,
      schemas: Object.values(schemas).reduce((acc, schema) => {
        acc[schema.identifier] = {
          primaryType: schema.EIP712TypedData.primaryType,
          types: schema.EIP712TypedData.types,
        };
        return acc;
      }, {} as Record<string, any>),
    });
  });

  // TODO: Break this route into a separate routes and handle validation pre-STF only
  app.post("/:reducerName", async (req: Request, res: Response) => {
    const { reducerName } = req.params;
    const actionReducer = transitions[reducerName];

    if (!actionReducer) {
      res.status(400).send({ message: "NO_REDUCER_FOR_ACTION" });
      return;
    }

    try {
      const inputs = {
        ...req.body,
        timestamp: Date.now(),
      };
      const signedAction = await signAsOperator(reducerName, inputs);
      const ack = await mru.submitAction(reducerName, signedAction);
      // const { errors } = await ack.waitFor(ActionConfirmationStatus.C1);
      // if (errors?.length) {
      //   throw new Error(errors[0].message);
      // }
      res.status(201).send({ ack });
    } catch (e: any) {
      res.status(400).send({ error: e.message });
    }
    return;
  });

  app.get("/teams", (_req: Request, res: Response) => {
    const { teams } = machine.state;
    return res.send(teams);
  });

  app.get("/matches/:id", (req: Request, res: Response) => {
    const { id } = req.params;
    const { logs } = machine.state;
    try {
      const matchInfo = getMatchInfo(+id);
      const matchLogs = logs
        .filter((l) => l.matchId === +id)
        .map((l) => {
          const playerInfo = getPlayerInfo(l.playerId);
          return {
            ...l,
            playerName: playerInfo.name,
            teamName: playerInfo.team,
          };
        });
      res.send({ ...matchInfo, logs: matchLogs });
    } catch (e) {
      res.status(404).send({ message: (e as Error).message });
    }
  });

  app.get("/current-matches", (_req: Request, res: Response) => {
    const { matches } = machine.state;
    const currentMatches = matches.filter(
      (m) => m.endTime === 0 && m.startTime !== 0
    );
    const matchesWithInfo = currentMatches.map((match) =>
      getMatchInfo(match.id)
    );

    return res.send(matchesWithInfo);
  });

  app.get("/next-matches", (_req: Request, res: Response) => {
    const { matches } = machine.state;
    const currentMatches = matches.filter((m) => m.startTime === 0);
    const matchesWithInfo = currentMatches.map((match) =>
      getMatchInfo(match.id)
    );

    return res.send(matchesWithInfo);
  });

  app.get("/team-leaderboard/:teamId", (_req: Request, res: Response) => {
    const { teamId } = _req.params;
    const leaderboard = getLeaderboard(machine.state);
    const { logs, players } = machine.state;
    const teamPlayers = players.filter((p) => p.teamId === +teamId);
    const teamLogs = logs.filter((l) =>
      teamPlayers.some((p) => p.id === l.playerId)
    );

    const sortedPlayersWithDetails = getPlayerLeaderboard(
      teamPlayers,
      teamLogs,
      leaderboard
    );
    return res.send(sortedPlayersWithDetails);
  });

  app.get("/player-leaderboard", (_req: Request, res: Response) => {
    const { logs, players } = machine.state;
    const leaderboard = getLeaderboard(machine.state);
    const sortedPlayersWithDetails = getPlayerLeaderboard(
      players,
      logs,
      leaderboard
    );

    return res.send(sortedPlayersWithDetails);
  });

  app.get("/leaderboard", (_req: Request, res: Response) => {
    const leaderboard = getLeaderboard(machine.state);
    res.send(leaderboard);
  });

  /**
   * Get Player information by ID
   */
  app.get("/players/:id", (req: Request, res: Response) => {
    const { id } = req.params;
    const player = machine.state.players.find((p) => p.id === +id);
    if (!player) {
      return res.status(404).send({ message: "PLAYER_NOT_FOUND" });
    }

    const goals =
      machine.state.logs
        .filter(
          ({ playerId, action }) =>
            (playerId === player.id && action === LogAction.GOAL) ||
            action === LogAction.DELETED_GOAL
        )
        .map(({ playerId, ...rest }) => ({ ...rest })) || [];

    const goalCount = goals.reduce((acc, goal) => {
      if (goal.action === LogAction.GOAL) {
        acc += 10;
      }
      return acc;
    }, 0);

    return res.send({
      ...player,
      goalCount,
      goals,
    });
  });

  app.get("/", (_req: Request, res: Response) => {
    return res.send({ state: machine.state });
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Running on port ${PORT}`);
  });
};

main();
