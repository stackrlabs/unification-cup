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

const main = async () => {
  /**
   * Initialize the MicroRollup instance
   */
  const mru = await MicroRollup({
    config: stackrConfig,
    actionSchemas: Object.values(schemas),
    stateMachines: [leagueMachine],
    stfSchemaMap: {
      startMatch: schemas.startMatch,
      endMatch: schemas.endMatch,
      recordGoal: schemas.recordGoal,
      startTournament: schemas.startTournament,
    },
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
      res.status(400).send({ message: "̦̦no reducer for action" });
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
  app.get("/player/:id", (req: Request, res: Response) => {
    const { id } = req.params;
    const player = machine.state.players.find((p) => p.id === +id);
    if (!player) {
      return res.status(404).send({ message: "PLAYER_NOT_FOUND" });
    }

    const goals =
      machine.state.logs
        .filter(
          ({ playerId, action }) =>
            playerId === player.id && action === LogAction.GOAL
        )
        .map(({ timestamp, matchId }) => ({ timestamp, matchId })) || [];

    return res.send({ ...player, goalCount: goals.length, goals });
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
