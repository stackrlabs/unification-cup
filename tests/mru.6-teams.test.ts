import { assert, expect } from "chai";

import {
  ActionConfirmationStatus,
  MicroRollup,
  StackrConfig,
} from "@stackr/sdk";
import { StateMachine } from "@stackr/sdk/machine";

import { STATE_MACHINES } from "../src/stackr/machines";
import { League, LeagueState } from "../src/stackr/state";
import { getLeaderboard, transitions } from "../src/stackr/transitions";
import { signByOperator } from "../src/utils";
import { stackrConfig } from "../stackr.config";

import genesisState6 from "./fixtures/genesis-state.6-teams.json";

const testConfig = {
  ...stackrConfig,
  isSandbox: true,
  logLevel: "error",
  sequencer: {
    ...stackrConfig.sequencer,
    blockTime: 10,
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
    stateMachines: [leagueMachine],
  });

  await mru.init();

  const _machine = mru.stateMachines.get<typeof leagueMachine>(
    STATE_MACHINES.LEAGUE
  );
  if (!_machine) {
    throw new Error("League machine not initialized yet");
  }
  machine = _machine;

  const performAction = async (name: string, _inputs: any) => {
    const inputs = {
      ..._inputs,
      timestamp: Date.now(),
    };
    const domain = mru.config.domain;
    const types = mru.getStfSchemaMap()[name];
    const { msgSender, signature } = await signByOperator(domain, types, {
      name,
      inputs,
    });
    const actionParams = {
      name,
      inputs,
      msgSender,
      signature,
    };
    const ack = await mru.submitAction(actionParams);
    const action = await ack.waitFor(ActionConfirmationStatus.C1);
    return action;
  };

  it("has 6 teams", async () => {
    expect(machine.state.teams.length).to.equal(6);
  });

  it("should be able to start a tournament", async () => {
    await performAction("startTournament", {});

    // should have 3 matches in the first round
    expect(machine.state.meta.round).to.equal(1);
    expect(machine.state.matches.length).to.equal(3);
  });

  it("should not be able to log a bye since not required in round 1", async () => {
    const team0 = machine.state.teams[0];

    const { errors } = await performAction("logByes", {
      teamId: team0.id,
    });

    if (!errors) {
      throw new Error("Error not found");
    }
    // check error for "BYE_NOT_REQUIRED_IN_THIS_ROUND"
    assert.typeOf(errors, "array");
    expect(errors.length).to.equal(1);
    expect(errors[0].message).to.equal(
      "Transition logByes failed to execute: BYE_NOT_REQUIRED_IN_THIS_ROUND"
    );
  });

  it("should be able to complete round 1", async () => {
    for (const match of machine.state.matches) {
      const matchId = match.id;
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

      // second team score a goal
      await performAction("logGoal", {
        matchId,
        playerId: teamTwoPlayers[0].id,
      });

      // first team score another goal
      await performAction("logGoal", {
        matchId,
        playerId: teamOnePlayers[1].id,
      });

      // second team saves a goal
      await performAction("logBlock", {
        matchId,
        playerId: teamTwoPlayers[1].id,
      });

      // first team does a foul
      await performAction("logFoul", {
        matchId,
        playerId: teamOnePlayers[1].id,
      });

      // end the game
      await performAction("endMatch", {
        matchId,
      });

      // check winner
      const _match = machine.state.matches.find((m) => m.id === matchId);
      expect(_match?.scores[team1Id]).to.greaterThan(_match?.scores[team2Id]!);
    }

    // no new round and no new match scheduled since odd teams w eq points
    // should have 0 new (incomplete) match at round 1
    expect(machine.state.meta.round).to.equal(1);
    const incompleteMatches = machine.state.matches.filter((m) => !m.endTime);
    expect(incompleteMatches.length).to.equal(0);
  });

  it("should be able to give a bye to a team not in round", async () => {
    expect(machine.state.meta.round).to.equal(1);

    const leaderboard = getLeaderboard(machine.state);

    // give bye to the team at 4th position in the leaderboard
    await performAction("logByes", {
      teamId: leaderboard[3].id,
    });

    // should have 5 total matches at round 2
    expect(machine.state.meta.round).to.equal(2);
    expect(machine.state.matches.length).to.equal(5);

    // should have 2 new (incomplete) matches at round 2
    const incompleteMatches = machine.state.matches.filter((m) => !m.endTime);
    expect(incompleteMatches.length).to.equal(2);
  });

  it("should be able to complete round 2", async () => {   
    for (const match of machine.state.matches) {
      const matchId = match.id;
      if (match.endTime) {
        continue;
      }

      await performAction("startMatch", {
        matchId,
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
        matchId,
        playerId: teamOnePlayers[0].id,
      });

      // second team score a goal
      await performAction("logGoal", {
        matchId,
        playerId: teamTwoPlayers[0].id,
      });

      // first team score another goal
      await performAction("logGoal", {
        matchId,
        playerId: teamOnePlayers[1].id,
      });

      // second team saves a goal
      await performAction("logBlock", {
        matchId,
        playerId: teamTwoPlayers[1].id,
      });

      // first team does a foul
      await performAction("logFoul", {
        matchId,
        playerId: teamOnePlayers[1].id,
      });

      // end the game
      await performAction("endMatch", {
        matchId,
      });

      // check winner
      const _match = machine.state.matches.find((m) => m.id === match.id);
      expect(_match?.scores[team1Id]).to.equal(2);
      expect(_match?.scores[team2Id]).to.equal(1);
      expect(_match?.scores[team1Id]).to.greaterThan(_match?.scores[team2Id]!);
    }

    // should have 6 total matches at round 3
    expect(machine.state.meta.round).to.equal(3);
    expect(machine.state.matches.length).to.equal(6);
    // should have 1 new (incomplete) match at round 3
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

    const { errors } = await performAction("logGoal", {
      matchId: match.id,
      playerId: teamOnePlayers[0].id,
    });
    if (!errors) {
      throw new Error("Error not found");
    }
    // check error for "MATCH_NOT_STARTED"
    assert.typeOf(errors, "array");
    expect(errors.length).to.equal(1);
    expect(errors[0].message).to.equal(
      "Transition logGoal failed to execute: MATCH_NOT_STARTED"
    );
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
      const { errors: errors1 } = await performAction("logGoal", {
        matchId: match.id,
        playerId: playersNotPlaying[0].id,
      });
      if (!errors1) {
        throw new Error("Error not found");
      }
      // check error for "INVALID_TEAM"
      assert.typeOf(errors1, "array");
      expect(errors1.length).to.equal(1);
      expect(errors1[0].message).to.equal(
        "Transition logGoal failed to execute: INVALID_TEAM"
      );

      // remove a goal when not scored
      const { errors: errors2 } = await performAction("removeGoal", {
        matchId: match.id,
        playerId: teamTwoPlayers[0].id,
      });

      if (!errors2) {
        throw new Error("Error not found");
      }
      // check error for "NO_GOALS_TO_REMOVE"
      assert.typeOf(errors2, "array");
      expect(errors2.length).to.equal(1);
      expect(errors2[0].message).to.equal(
        "Transition removeGoal failed to execute: NO_GOALS_TO_REMOVE"
      );

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
      await performAction("penaltyShootout", {
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

    const { errors } = await performAction("logGoal", {
      matchId: match.id,
      playerId: teamOnePlayers[0].id,
    });

    if (!errors) {
      throw new Error("Error not found");
    }
    // check error for "TOURNAMENT_ENDED"
    assert.typeOf(errors, "array");
    expect(errors.length).to.equal(1);
    expect(errors[0].message).to.equal(
      "Transition logGoal failed to execute: TOURNAMENT_ENDED"
    );
  });

  it("should end the tournament", async () => {
    expect(machine.state.meta.endTime).to.not.equal(0);
    expect(machine.state.meta.winnerTeamId).to.equal(2);
  });
});
