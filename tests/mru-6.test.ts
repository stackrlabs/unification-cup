import {
  ActionConfirmationStatus,
  MicroRollup,
  StackrConfig,
} from "@stackr/sdk";
import { StateMachine } from "@stackr/sdk/machine";
import genesisState6 from "../genesis/genesis-state.6.json";
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

describe("League with 6 teams", async () => {
  const initialState = genesisState6.state;
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
    const signedAction1 = await signAsOperator(schemaName, {
      ...inputs,
      timestamp: Date.now(),
    });
    const ack1 = await mru.submitAction(schemaName, signedAction1);
    const action = await ack1.waitFor(ActionConfirmationStatus.C1);
    return action;
  };

  it("has 6 teams", async () => {
    expect(machine.state.teams.length).to.equal(6);
  });

  it("should be able to start a tournament", async () => {
    await performAction("startTournament", {});

    // should have 2 matches in the first round
    expect(machine.state.meta.round).to.equal(1);
    expect(machine.state.matches.length).to.equal(3);
  });

  it("should be able to complete round 1", async () => {
    for (const match of machine.state.matches) {
      await performAction("startMatch", {
        matchId: match.id,
      });
      const teamIds = Object.keys(match.scores).map((k) => parseInt(k));

      const team1Id = teamIds[0];
      const teamOnePlayers = machine.state.players.filter(
        (p) => p.teamId === team1Id
      );
      if (!teamOnePlayers.length) {
        throw new Error("Players not found");
      }

      const team2Id = teamIds[1];
      const teamTwoPlayers = machine.state.players.filter(
        (p) => p.teamId === team2Id
      );
      if (!teamTwoPlayers.length) {
        throw new Error("Players not found");
      }

      // first team score a goal
      await performAction("logGoal", {
        matchId: match.id,
        playerId: teamOnePlayers[0].id,
      });

      // second team score a goal
      await performAction("logGoal", {
        matchId: match.id,
        playerId: teamTwoPlayers[0].id,
      });

      // first team score another goal
      await performAction("logGoal", {
        matchId: match.id,
        playerId: teamOnePlayers[1].id,
      });

      // second team saves a goal
      await performAction("logBlock", {
        matchId: match.id,
        playerId: teamTwoPlayers[1].id,
      });

      // first team does a foul
      await performAction("logFoul", {
        matchId: match.id,
        playerId: teamOnePlayers[1].id,
      });

      // end the game
      await performAction("endMatch", {
        matchId: match.id,
      });

      // check winner
      const _match = machine.state.matches.find((m) => m.id === match.id);
      expect(_match?.scores[team1Id]).to.greaterThan(_match?.scores[team2Id]!);
    }

    // no new match scheduled for odd teams
    // should have 0 incomplete match at round 2
    const incompleteMatches = machine.state.matches.filter((m) => !m.endTime);
    expect(incompleteMatches.length).to.equal(0);
  });

  it("should be able to give a bye to team 5", async () => {
    // give bye to the team 5
    await performAction("logByes", {
      teamId: 5,
    });

    // should have 2 new matches in the second round
    expect(machine.state.meta.round).to.equal(2);
    expect(machine.state.matches.length).to.equal(4);

    // should have 1 incomplete match at round 2
    const incompleteMatches = machine.state.matches.filter((m) => !m.endTime);
    expect(incompleteMatches.length).to.equal(1);
  });

  it("should be able to complete round 2", async () => {
    for (const match of machine.state.matches) {
      if (match.endTime) {
        continue;
      }

      await performAction("startMatch", {
        matchId: match.id,
      });
      const teamIds = Object.keys(match.scores).map((k) => parseInt(k));

      const team1Id = teamIds[0];
      const teamOnePlayers = machine.state.players.filter(
        (p) => p.teamId === team1Id
      );
      if (!teamOnePlayers.length) {
        throw new Error("Players not found");
      }

      const team2Id = teamIds[1];
      const teamTwoPlayers = machine.state.players.filter(
        (p) => p.teamId === team2Id
      );
      if (!teamTwoPlayers.length) {
        throw new Error("Players not found");
      }

      // first team score a goal
      await performAction("logGoal", {
        matchId: match.id,
        playerId: teamOnePlayers[0].id,
      });

      // second team score a goal
      await performAction("logGoal", {
        matchId: match.id,
        playerId: teamTwoPlayers[0].id,
      });

      // first team score another goal
      await performAction("logGoal", {
        matchId: match.id,
        playerId: teamOnePlayers[1].id,
      });

      // second team saves a goal
      await performAction("logBlock", {
        matchId: match.id,
        playerId: teamTwoPlayers[1].id,
      });

      // first team does a foul
      await performAction("logFoul", {
        matchId: match.id,
        playerId: teamOnePlayers[1].id,
      });

      // end the game
      await performAction("endMatch", {
        matchId: match.id,
      });

      // check winner
      const _match = machine.state.matches.find((m) => m.id === match.id);
      expect(_match?.scores[team1Id]).to.equal(2);
      expect(_match?.scores[team2Id]).to.equal(1);
      expect(_match?.scores[team1Id]).to.greaterThan(_match?.scores[team2Id]!);
    }

    // should have 1 incomplete match at round 3
    const incompleteMatches = machine.state.matches.filter((m) => !m.endTime);
    expect(incompleteMatches.length).to.equal(1);
  });

  it("should not be able to score goal before a match starts", async () => {
    const match = machine.state.matches.filter((m) => !m.endTime)[0];
    const teamIds = Object.keys(match.scores).map((k) => parseInt(k));
    const team1Id = teamIds[0];
    const teamOnePlayers = machine.state.players.filter(
      (p) => p.teamId === team1Id
    );
    if (!teamOnePlayers) {
      throw new Error("Players not found");
    }

    const { logs, errors } = await performAction("logGoal", {
      matchId: match.id,
      playerId: teamOnePlayers[0].id,
    });
    // check error for "MATCH_NOT_STARTED"
    expect(typeof errors).to.be.equal("object");
    expect(errors?.length).to.not.equal(0);
    expect(errors![0].message).to.equal("MATCH_NOT_STARTED");
  });

  it("should be able complete a round 3", async () => {
    for (const match of machine.state.matches) {
      if (match.endTime) {
        continue;
      }

      const matchId = match.id;
      const matchIdx = machine.state.matches.findIndex((m) => m.id === matchId);
      await performAction("startMatch", {
        matchId,
      });

      const teamIds = Object.keys(match.scores).map((k) => parseInt(k));
      const [team1Id, team2Id] = teamIds;

      const teamOnePlayers = machine.state.players.filter(
        (p) => p.teamId === team1Id
      );
      if (!teamOnePlayers.length) {
        throw new Error("Players not found");
      }

      const teamTwoPlayers = machine.state.players.filter(
        (p) => p.teamId === team2Id
      );
      if (!teamTwoPlayers.length) {
        throw new Error("Players not found");
      }

      // first team score a goal
      await performAction("logGoal", {
        matchId,
        playerId: teamOnePlayers[0].id,
      });

      // first team score another goal
      await performAction("logGoal", {
        matchId,
        playerId: teamOnePlayers[1].id,
      });

      // removing a goal
      await performAction("removeGoal", {
        matchId,
        playerId: teamOnePlayers[1].id,
      });

      // try scoring a goal from a player that is not playing
      const playersNotPlaying = machine.state.players.filter(
        (p) => p.teamId !== team1Id && p.teamId !== team2Id
      );
      const { logs: logs1, errors: errors1 } = await performAction("logGoal", {
        matchId: match.id,
        playerId: playersNotPlaying[0].id,
      });
      // check error for "PLAYER_NOT_FOUND"
      expect(typeof errors1).to.be.equal("object");
      expect(errors1?.length).to.not.equal(0);
      expect(errors1![0].message).to.equal("INVALID_TEAM");

      // remove a goal when not scored
      const { logs: logs2, errors: errors2 } = await performAction(
        "removeGoal",
        {
          matchId: match.id,
          playerId: teamTwoPlayers[0].id,
        }
      );
      // check error for "PLAYER_NOT_FOUND"
      expect(typeof errors2).to.be.equal("object");
      expect(errors2?.length).to.not.equal(0);
      expect(errors2![0].message).to.equal("NO_GOALS_TO_REMOVE");

      // second team score a goal
      await performAction("logGoal", {
        matchId,
        playerId: teamTwoPlayers[0].id,
      });

      // have equal scores
      expect(machine.state.matches[matchIdx].scores[team1Id]).to.equal(
        machine.state.matches[matchIdx].scores[team2Id]
      );

      // start a penalty shootout
      await performAction("startPenaltyShootout", {
        matchId,
      });

      expect(machine.state.matches[matchIdx].penaltyStartTime).to.not.equal(0);

      // first team penalty hit
      await performAction("logPenaltyHit", {
        matchId,
        playerId: teamOnePlayers[0].id,
      });

      // second team penalty hit
      await performAction("logPenaltyHit", {
        matchId,
        playerId: teamTwoPlayers[1].id,
      });

      // first team penalty miss
      await performAction("logPenaltyMiss", {
        matchId,
        playerId: teamOnePlayers[1].id,
      });

      // second team penalty hit
      await performAction("logPenaltyHit", {
        matchId,
        playerId: teamTwoPlayers[2].id,
      });

      // end the game
      await performAction("endMatch", {
        matchId,
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

  it("should not be able to score goal after a match ends", async () => {
    const match = machine.state.matches.at(-1);
    if (!match) {
      throw new Error("Match not found");
    }
    const teamIds = Object.keys(match.scores).map((k) => parseInt(k));
    const team1Id = teamIds[0];
    const teamOnePlayers = machine.state.players.filter(
      (p) => p.teamId === team1Id
    );
    if (!teamOnePlayers.length) {
      throw new Error("Players not found");
    }

    const { logs, errors } = await performAction("logGoal", {
      matchId: match.id,
      playerId: teamOnePlayers[0].id,
    });
    // check error for "TOURNAMENT_ENDED"
    expect(typeof errors).to.be.equal("object");
    expect(errors?.length).to.not.equal(0);
    expect(errors![0].message).to.equal("TOURNAMENT_ENDED");
  });

  it("should end the tournament", async () => {
    expect(machine.state.meta.endTime).to.not.equal(0);
    expect(machine.state.meta.winnerTeamId).to.equal(5);
  });
});
