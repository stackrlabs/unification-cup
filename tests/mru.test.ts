import {
  ActionConfirmationStatus,
  MicroRollup,
  StackrConfig,
} from "@stackr/sdk";
import { StateMachine } from "@stackr/sdk/machine";
import genesisState4 from "../genesis/genesis-state.4.json";
import { stfSchemaMap } from "../src";
import { schemas } from "../src/stackr/actions";
import { STATE_MACHINES } from "../src/stackr/machines";
import { League, LeagueState } from "../src/stackr/state";
import { transitions } from "../src/stackr/transitions";
import { stackrConfig } from "../stackr.config";

import { expect } from "chai";
import { signAsOperator } from "../src/utils";

const testConfig = {
  ...stackrConfig,
  logLevel: "error",
  sequencer: {
    ...stackrConfig.sequencer,
    blockTime: 100,
  },
} as StackrConfig;

describe("League with 4 teams", async () => {
  const initialState = genesisState4.state;
  let machine: StateMachine<LeagueState, LeagueState>;

  const leagueMachine = new StateMachine({
    id: STATE_MACHINES.LEAGUE,
    stateClass: League,
    initialState,
    on: transitions,
  });

  // setup MicroRollup
  const mru = await MicroRollup({
    config: testConfig,
    actionSchemas: Object.values(schemas),
    stateMachines: [leagueMachine],
    stfSchemaMap: stfSchemaMap,
    isSandbox: true,
  });

  await mru.init();

  const _machine = mru.stateMachines.get<typeof leagueMachine>(
    STATE_MACHINES.LEAGUE
  );
  if (!_machine) {
    throw new Error("League machine not initialized yet");
  }
  machine = _machine;

  const performAction = async (schemaName: string, inputs: any) => {
    const signedAction1 = await signAsOperator(schemaName, inputs);
    const ack1 = await mru.submitAction(schemaName, signedAction1);
    await ack1.waitFor(ActionConfirmationStatus.C1);
  };

  it("has 4 teams", async () => {
    expect(machine.state.teams.length).to.equal(4);
  });

  it("should be able to start a tournament", async () => {
    await performAction("startTournament", {
      timestamp: Date.now(),
    });

    console.log("should have 2 match in the round 1");
    expect(machine.state.meta.round).to.equal(1);
    expect(machine.state.matches.length).to.equal(2);
  });

  it("should be able to complete round 1", async () => {
    for (const match of machine.state.matches) {
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
    }

    console.log("should have 1 final match at round 2");
    expect(machine.state.meta.round).to.equal(2);
    expect(machine.state.matches.length).to.equal(3);

    const incompleteMatches = machine.state.matches.filter((m) => !m.endTime);
    expect(incompleteMatches.length).to.equal(1);
  });

  it("should be able complete a round 2 (final)", async () => {
    for (const match of machine.state.matches) {
      if (match.endTime) {
        continue;
      }

      const matchId = match.id;
      const matchIdx = machine.state.matches.findIndex((m) => m.id === matchId);
      await performAction("startMatch", {
        matchId,
        timestamp: Date.now(),
      });

      const teamIds = Object.keys(match.scores).map((k) => parseInt(k));
      const [team1Id, team2Id] = teamIds;

      const teamOnePlayers = machine.state.players.filter(
        (p) => p.teamId === team1Id
      );
      if (!teamOnePlayers) {
        throw new Error("Player not found");
      }

      const teamTwoPlayers = machine.state.players.filter(
        (p) => p.teamId === team2Id
      );
      if (!teamTwoPlayers) {
        throw new Error("Player not found");
      }

      // first team score a goal
      await performAction("logGoal", {
        matchId,
        playerId: teamOnePlayers[0].id,
        timestamp: Date.now(),
      });

      // second team score a goal
      await performAction("logGoal", {
        matchId,
        playerId: teamTwoPlayers[0].id,
        timestamp: Date.now(),
      });

      // have equal scores
      expect(machine.state.matches[matchIdx].scores[team1Id]).to.equal(
        machine.state.matches[matchIdx].scores[team2Id]
      );

      // start a penalty shootout
      await performAction("startPenaltyShootout", {
        matchId,
        timestamp: Date.now(),
      });

      expect(machine.state.matches[matchIdx].penaltyStartTime).to.not.equal(
        undefined
      );

      // first team penalty hit
      await performAction("logPenaltyHit", {
        matchId,
        playerId: teamOnePlayers[0].id,
        timestamp: Date.now(),
      });

      // second team penalty hit
      await performAction("logPenaltyHit", {
        matchId,
        playerId: teamTwoPlayers[1].id,
        timestamp: Date.now(),
      });

      // first team penalty miss
      await performAction("logPenaltyMiss", {
        matchId,
        playerId: teamOnePlayers[1].id,
        timestamp: Date.now(),
      });

      // second team penalty hit
      await performAction("logPenaltyHit", {
        matchId,
        playerId: teamTwoPlayers[2].id,
        timestamp: Date.now(),
      });

      // end the game
      await performAction("endMatch", {
        matchId,
        timestamp: Date.now(),
      });

      const incompleteMatches = machine.state.matches.filter((m) => !m.endTime);

      expect(incompleteMatches.length).to.equal(0);
      const lastMatch = machine.state.matches.at(-1);
      if (!lastMatch) {
        throw new Error("Match not found");
      }
      expect(lastMatch.endTime).to.not.equal(0);
    }
  });

  it("should end the tournament", async () => {
    expect(machine.state.meta.endTime).to.not.equal(0);
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
