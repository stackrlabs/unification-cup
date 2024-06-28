import {
  ActionConfirmationStatus,
  MicroRollup,
  MicroRollupResponse,
  WaitableConfirmationStatus,
} from "@stackr/sdk";
import { stackrConfig } from "../stackr.config";
import { schemas } from "../src/stackr/actions";
import {
  LeagueMachine,
  leagueMachine,
  STATE_MACHINES,
} from "../src/stackr/machines";
import { stfSchemaMap } from "../src";
import { StateMachine } from "@stackr/sdk/machine";
import { League, LeagueState } from "../src/stackr/state";
import { transitions } from "../src/stackr/transitions";
import genesisState4 from "../genesis/genesis-state.4.json";
import genesisState6 from "../genesis/genesis-state.6.json";

import { signAsOperator } from "../src/utils";
import { expect } from "chai";

const sleep = (timeInMs: number) =>
  new Promise((resolve) => setTimeout(resolve, timeInMs));

describe("Unification League MRU with 4 teams", async () => {
  const genesisState = genesisState4.state;
  let machine: StateMachine<LeagueState, LeagueState>;
  let mru: MicroRollupResponse;

  beforeEach(async () => {
    // setup State Machine
    const leagueMachine = new StateMachine({
      id: STATE_MACHINES.LEAGUE,
      stateClass: League,
      initialState: genesisState,
      on: transitions,
    });

    // setup MicroRollup
    mru = await MicroRollup({
      config: stackrConfig,
      actionSchemas: Object.values(schemas),
      stateMachines: [leagueMachine],
      stfSchemaMap: stfSchemaMap,
      isSandbox: process.env.NODE_ENV === "sandbox",
    });

    await mru.init();

    const _machine = mru.stateMachines.get<typeof leagueMachine>(
      STATE_MACHINES.LEAGUE
    );
    if (!_machine) {
      throw new Error("League machine not initialized yet");
    }
    machine = _machine;
  });

  afterEach(async () => {
    await mru.shutdown();
  });

  const performAction = async (schemaName: string, inputs: any) => {
    const signedAction1 = await signAsOperator(schemaName, inputs);
    const ack1 = await mru.submitAction(schemaName, signedAction1);
    await ack1.waitFor(ActionConfirmationStatus.C1);
  };

  // start tests
  it("should be able complete a tournament", async () => {
    expect(machine.state.teams.length).to.equal(4);

    // 1. start tornament action
    // const signedAction = await signAsOperator(reducerName, inputs);
    await performAction("startTournament", {
      timestamp: Date.now(),
    });
    await sleep(stackrConfig.sequencer.blockTime);

    console.log("should have 2 match in the round 1");
    expect(machine.state.meta.round).to.equal(1);
    expect(machine.state.matches.length).to.equal(2);

    // start all the match one by one
    // log some actions
    machine.state.matches.forEach(async (match) => {
      await performAction("startMatch", {
        matchId: match.id,
        timestamp: Date.now(),
      });
      const teamIds = Object.keys(match.scores).map((k) => parseInt(k));

      const team1Id = teamIds[0];
      const players1 = machine.state.players.filter(
        (p) => p.teamId === team1Id
      );
      if (!players1) {
        throw new Error("Player not found");
      }

      const team2Id = teamIds[1];
      const players2 = machine.state.players.filter(
        (p) => p.teamId === team2Id
      );
      if (!players2) {
        throw new Error("Player not found");
      }

      // first team score a goal
      await performAction("logGoal", {
        matchId: match.id,
        playerId: players1[0].id,
        timestamp: Date.now(),
      });

      // second team score a goal
      await performAction("logGoal", {
        matchId: match.id,
        playerId: players2[0].id,
        timestamp: Date.now(),
      });

      // first team score another goal
      await performAction("logGoal", {
        matchId: match.id,
        playerId: players1[1].id,
        timestamp: Date.now(),
      });

      // second team saves a goal
      await performAction("logBlock", {
        matchId: match.id,
        playerId: players2[1].id,
        timestamp: Date.now(),
      });

      // first team does a foul
      await performAction("logFoul", {
        matchId: match.id,
        playerId: players1[1].id,
        timestamp: Date.now(),
      });

      // end the game
      await performAction("endMatch", {
        matchId: match.id,
        timestamp: Date.now(),
      });
    });

    await sleep(stackrConfig.sequencer.blockTime);

    console.log("should have 1 final match at round 2");
    expect(machine.state.meta.round).to.equal(2);
    expect(machine.state.matches.length).to.equal(1);

    machine.state.matches.forEach(async (match) => {
      await performAction("startMatch", {
        matchId: match.id,
        timestamp: Date.now(),
      });

      const teamIds = Object.keys(match.scores).map((k) => parseInt(k));

      const team1Id = teamIds[0];
      const players1 = machine.state.players.filter(
        (p) => p.teamId === team1Id
      );
      if (!players1) {
        throw new Error("Player not found");
      }

      const team2Id = teamIds[1];
      const players2 = machine.state.players.filter(
        (p) => p.teamId === team2Id
      );
      if (!players2) {
        throw new Error("Player not found");
      }

      // first team score a goal
      await performAction("logGoal", {
        matchId: match.id,
        playerId: players1[0].id,
        timestamp: Date.now(),
      });

      // second team score a goal
      await performAction("logGoal", {
        matchId: match.id,
        playerId: players2[0].id,
        timestamp: Date.now(),
      });

      // start a penalty shootout
      await performAction("startPenaltyShootout", {
        matchId: match.id,
        timestamp: Date.now(),
      });

      // first team penalty hit
      await performAction("logPenaltyHit", {
        matchId: match.id,
        playerId: players1[0].id,
        timestamp: Date.now(),
      });

      // second team penalty hit
      await performAction("logPenaltyHit", {
        matchId: match.id,
        playerId: players2[1].id,
        timestamp: Date.now(),
      });

      // first team penalty miss
      await performAction("logPenaltyMiss", {
        matchId: match.id,
        playerId: players1[1].id,
        timestamp: Date.now(),
      });

      // second team penalty hit
      await performAction("logPenaltyHit", {
        matchId: match.id,
        playerId: players2[2].id,
        timestamp: Date.now(),
      });

      // end the game
      await performAction("endMatch", {
        matchId: match.id,
        timestamp: Date.now(),
      });
    });

    await sleep(stackrConfig.sequencer.blockTime);

    // check final state
    // should have a winner
    expect(machine.state.meta.winnerTeamId).to.not.equal(0);
  });
});

// Test cases
// check winners for matches
// no new match in case of odd teams , need to do bye
// check for penalty shootout winner
// we can't remove goal for a which is not even scored

// start penalty shootout in one case
// maybe a shootout in one of the matches
