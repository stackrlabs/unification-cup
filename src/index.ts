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
  canAddressSubmitAction,
  getLeaderboard,
  LeaderboardEntry,
  LogAction,
  transitions,
} from "./stackr/transitions.ts";

dotenv.config();

import {
  ActionConfirmationStatus,
  ActionExecutionStatus,
  MicroRollup,
} from "@stackr/sdk";
import { Logs, Player } from "./stackr/state.ts";
import { PlayerStats } from "./types.ts";
import { getActionInfo } from "./utils.ts";

export const stfSchemaMap = {
  startTournament: schemas.startTournament,
  startMatch: schemas.startMatch,
  logGoal: schemas.logGoal,
  logFoul: schemas.logGoal,
  logBlock: schemas.logGoal,
  penaltyShootout: schemas.startMatch,
  logPenaltyHit: schemas.logGoal,
  logPenaltyMiss: schemas.logGoal,
  endMatch: schemas.endMatch,
  logByes: schemas.logByes,
  addPlayer: schemas.addPlayer,
  removePlayer: schemas.removePlayer,
  removeGoal: schemas.logGoal,
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
    const playerWiseStats = logs.reduce((acc, log) => {
      if (!acc[log.playerId]) {
        acc[log.playerId] = {
          goals: 0,
          blocks: 0,
          penalties: 0,
          penaltyMisses: 0,
          fouls: 0,
        };
      }
      if (log.action === LogAction.GOAL) {
        acc[log.playerId].goals += 1;
      } else if (log.action === LogAction.DELETED_GOAL) {
        acc[log.playerId].goals -= 1;
      } else if (log.action === LogAction.BLOCK) {
        acc[log.playerId].blocks += 1;
      } else if (log.action === LogAction.PENALTY_HIT) {
        acc[log.playerId].penalties += 1;
      } else if (log.action === LogAction.PENALTY_MISS) {
        acc[log.playerId].penaltyMisses += 1;
      } else if (log.action === LogAction.FOUL) {
        acc[log.playerId].fouls += 1;
      }
      return acc;
    }, {} as Record<string, PlayerStats>);

    const playerWithDetails = players
      .filter((p) => !p.removedAt)
      .map((p) => getPlayerInfo(p.id));

    const sortedPlayersWithDetails = playerWithDetails
      .map((playerInfo) => {
        const { id, teamId } = playerInfo;
        const teamPoints =
          leaderboard.find((l) => l.id === teamId)?.points || 0;

        const {
          goals = 0,
          blocks = 0,
          penalties = 0,
          fouls = 0,
          penaltyMisses = 0,
        } = playerWiseStats[id] || {};

        return {
          ...playerInfo,
          goals,
          blocks,
          penalties,
          fouls,
          points:
            goals * 10 +
            teamPoints * 1 +
            blocks * 7 +
            penalties * 5 -
            penaltyMisses * 1 -
            fouls * 2,
        };
      })
      .sort((a, b) => b.points - a.points);

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

  if (process.env.NODE_ENV === "sandbox") {
    app.get("/restart", () => {
      process.exit(1);
    });
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
      const { msgSender, signature, inputs } = req.body;

      // reject right away if msgSender is not authorized to submit actions
      if (!canAddressSubmitAction(machine.state, String(msgSender))) {
        res.status(401).send({ error: "UNAUTHORIZED_FOR_ACTION" });
        return;
      }

      const actionSchema = stfSchemaMap[reducerName as keyof typeof schemas];
      // const signedAction = await signAsOperator(reducerName, inputs);
      const signedAction = actionSchema.actionFrom({
        msgSender,
        signature,
        inputs,
      });
      const ack = await mru.submitAction(reducerName, signedAction);
      const { errors } = await ack.waitFor(ActionConfirmationStatus.C1);
      if (errors?.length) {
        throw new Error(errors[0].message);
      }
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

  app.get("/matches", (_req: Request, res: Response) => {
    const { matches } = machine.state;
    const matchesWithInfo = matches.map((match) => getMatchInfo(match.id));

    return res.send(matchesWithInfo);
  });

  app.get("/live-matches", (_req: Request, res: Response) => {
    const { matches } = machine.state;
    const liveMatches = matches.filter(
      (m) => m.startTime > 0 && m.endTime === 0
    );
    const matchesWithInfo = liveMatches.map((match) => getMatchInfo(match.id));

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
   * Get all Players information.
   */
  app.get("/players", (_req: Request, res: Response) => {
    const { players } = machine.state;
    return res.send(players.filter((p) => !p.removedAt));
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
            playerId === player.id &&
            (action === LogAction.GOAL || action === LogAction.DELETED_GOAL)
        )
        .map(({ playerId, ...rest }) => ({ ...rest })) || [];

    const goalCount = goals.reduce((acc, goal) => {
      if (goal.action === LogAction.GOAL) {
        acc += 1;
      }
      return acc;
    }, 0);

    return res.send({
      ...player,
      goalCount,
      goals,
    });
  });

  app.get("/awards", (_req: Request, res: Response) => {
    const { state } = machine;
    const leaderboard = getLeaderboard(state);
    const { logs, players } = state;
    const sortedPlayersWithDetails = getPlayerLeaderboard(
      players,
      logs,
      leaderboard
    );
    const [goldenBall] = sortedPlayersWithDetails.sort(
      (a, b) => b.points - a.points
    );
    const [goldenBoot] = sortedPlayersWithDetails.sort(
      (a, b) => b.goals - a.goals
    );
    const [goldenGlove] = sortedPlayersWithDetails.sort(
      (a, b) => b.blocks - a.blocks
    );

    return res.send({ goldenBall, goldenBoot, goldenGlove });
  });

  app.get("/tournament-info", (_req: Request, res: Response) => {
    const { meta, teams } = machine.state;
    const tournament = {
      ...meta,
      winnerTeam: teams.find((t) => t.id === meta.winnerTeamId),
    };

    return res.send(tournament);
  });

  app.get("/actions", async (_req: Request, res: Response) => {
    const actionsAndBlocks = await mru.actions.query(
      {
        executionStatus: ActionExecutionStatus.ACCEPTED,
        confirmationStatus: [
          ActionConfirmationStatus.C1, // quick
          ActionConfirmationStatus.C2,
          ActionConfirmationStatus.C3A,
          ActionConfirmationStatus.C3B,
        ],
        block: {
          isReverted: false,
        },
      },
      false
    );

    const actions = actionsAndBlocks.map((actionAndBlock) => {
      const { name, payload, hash, block } = actionAndBlock;
      const actionInfo = getActionInfo(payload, machine.state);

      return {
        name,
        payload,
        hash,
        actionInfo,
        blockInfo: block
          ? {
              height: block.height,
              hash: block.hash,
              timestamp: block.timestamp,
              status: block.status,
              daMetadata: {
                blockHeight:
                  block.batchInfo?.daMetadata?.avail?.blockHeight || null,
                extIdx: block.batchInfo?.daMetadata?.avail?.extIdx || null,
              },
              l1TxHash: block.batchInfo?.l1TransactionHash || null,
            }
          : null,
      };
    });

    return res.send(actions);
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
