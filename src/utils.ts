import { Domain } from "@stackr/sdk";
import { AllowedInputTypes, EIP712Types } from "@stackr/sdk/machine";
import { Wallet } from "ethers";

import { LeagueState } from "./stackr/state";

const signByOperator = async (
  domain: Domain,
  types: EIP712Types,
  payload: { name: string, inputs: AllowedInputTypes }
) => {
  const wallet = new Wallet(process.env.PRIVATE_KEY as string);
  const signature = await wallet.signTypedData(domain, types, payload);
  return { msgSender: wallet.address, signature };
};

type ActionInfo = {
  matchName?: string;
  teamName?: string;
  playerName?: string;
};

const getActionInfo = (
  payload: AllowedInputTypes,
  state: LeagueState
): ActionInfo | null => {
  const payloadKeys = Object.keys(payload);
  const actionInfo: ActionInfo = {};

  payloadKeys.forEach((key) => {
    if (key === "matchId") {
      const match = state.matches.find((match) => match.id === payload.matchId);
      if (!match) {
        return null;
      }
      const teamIds = Object.keys(match?.scores).map((k) => parseInt(k));
      const matchInfo = {
        matchId: payload.matchId,
        team1Name: state.teams.find((team) => team.id === teamIds[0])?.name,
        team2Name: state.teams.find((team) => team.id === teamIds[1])?.name,
      };
      actionInfo.matchName = `#${matchInfo.matchId} ${matchInfo.team1Name} vs ${matchInfo.team2Name}`;
      return;
    }

    if (key === "playerId") {
      const player = state.players.find(
        (player) => player.id === payload.playerId
      );
      if (!player) {
        return null;
      }
      actionInfo.playerName = player.name;
      return;
    }

    if (key === "teamId") {
      const team = state.teams.find((team) => team.id === payload.teamId);
      if (!team) {
        return null;
      }
      actionInfo.teamName = team.name;
    }
  });

  return actionInfo;
};

export { signByOperator, getActionInfo };
