import {
  Manager,
  Match,
  Player,
  Tournament,
} from "tournament-organizer/components";

import {
  MatchValues,
  PlayerValues,
  SettableMatchValues,
  SettablePlayerValues,
  SettableTournamentValues,
  StandingsValues,
  TournamentValues,
} from "tournament-organizer/interfaces";

const tournament = new Tournament("1", "Tournament 1");
tournament.createPlayer("1", "Player 1");
const team = new Team();
