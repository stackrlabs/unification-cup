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
  getPointsByTeam,
  LogAction,
  transitions,
} from "./stackr/transitions.ts";

dotenv.config();

import { MicroRollup } from "@stackr/sdk";
import { signAsOperator } from "./utils.ts";

export const stfSchemaMap = {
  startMatch: schemas.startMatch,
  endMatch: schemas.endMatch,
  recordGoal: schemas.recordGoal,
  removeGoal: schemas.recordGoal,
  logPenalty: schemas.recordGoal,
  startTournament: schemas.startTournament,
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

  const machine = mru.stateMachines.get<LeagueMachine>(STATE_MACHINES.LEAGUE);

  if (!machine) {
    throw new Error("League machine not initialized yet");
  }

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
      res.status(201).send({ ack });
    } catch (e: any) {
      res.status(400).send({ error: e.message });
    }
    return;
  });

  app.get("/player-leaderboard", (_req: Request, res: Response) => {
    const playerWiseGoals = machine.state.logs.reduce((acc, log) => {
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

    const sortedPlayersWithDetails = Object.keys(playerWiseGoals)
      .map((pId) => {
        const playerInfo = machine.state.players.find((p) => p.id === +pId);
        return {
          ...playerInfo,
          goals: playerWiseGoals[pId],
        };
      })
      .sort((a, b) => b.goals - a.goals);

    res.send(sortedPlayersWithDetails);
  });

  app.get("/leaderboard", (req: Request, res: Response) => {
    const pointsByTeam = getPointsByTeam(machine.state);
    const sortedTeamsWithDetails = Object.keys(pointsByTeam)
      .map((tId) => {
        const teamDetails = machine.state.teams.find((t) => t.id === +tId);
        return {
          ...teamDetails,
          points: pointsByTeam[tId],
        };
      })
      .sort((a, b) => b.points - a.points);

    res.send(sortedTeamsWithDetails);
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

    const penalties = machine.state.logs
      .filter(
        ({ playerId, action }) =>
          playerId === player.id && action === LogAction.PENALTY
      )
      .map(({ playerId, ...rest }) => ({ ...rest })) || [];

    const goals =
      machine.state.logs
        .filter(
          ({ playerId, action }) =>
            playerId === player.id && action === LogAction.GOAL || action === LogAction.DELETED_GOAL
        )
        .map(({ playerId, ...rest }) => ({ ...rest })) || [];

      const goalCount = goals.reduce((acc, goal) => {
        if (goal.action === LogAction.GOAL) {
          acc += 1;
        } else {
          acc -= 1;
        }
        return acc;
      }, 0);


    return res.send({ ...player, goalCount, goals, penalties, penaltiesCount: penalties.length });
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
