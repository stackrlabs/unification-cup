import { StateMachine } from "@stackr/sdk/machine";
import genesisState from "../../genesis-state.json";
import { League } from "./state";
import { transitions } from "./transitions";

const STATE_MACHINES = {
  LEAGUE: "league",
};

const leagueMachine = new StateMachine({
  id: STATE_MACHINES.LEAGUE,
  stateClass: League,
  initialState: genesisState.state,
  on: transitions,
});

type LeagueMachine = typeof leagueMachine;

export { STATE_MACHINES, leagueMachine, LeagueMachine };
