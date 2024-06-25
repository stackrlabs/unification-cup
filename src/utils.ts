import { ethers } from "ethers";
import { schemas } from "./stackr/actions";
import { stackrConfig } from "../stackr.config";
import { stfSchemaMap } from ".";
import { LeagueState } from "./stackr/state";

/**
 * Sign and submit action as operator
 * @param transitionName
 * @param inputs
 * @returns signed action
 */
const signAsOperator = async (schemaName: string, inputs: any) => {
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY as string);
  const actionSchema = stfSchemaMap[schemaName as keyof typeof schemas];

  const msgSender = wallet.address;
  const signature = await wallet.signTypedData(
    stackrConfig.domain,
    actionSchema.EIP712TypedData.types,
    inputs
  );

  return actionSchema.actionFrom({
    msgSender,
    signature,
    inputs,
  });
};

type ActionInfo = {
  match?: {
    matchId: number;
    team1Name?: string;
    team1Id: number;
    team2Name?: string;
    team2Id: number;
  };
  team?: {
    teamName: string;
    teamId: number;
  };
  player?: {
    playerName: string;
    playerId: number;
  };
};

const getActionInfo = (payload: any, state: LeagueState): ActionInfo | null => {
  const payloadKeys = Object.keys(payload);
  const actionInfo: ActionInfo = {};

  if (payloadKeys.includes("matchId")) {
    const match = state.matches.find((match) => match.id === payload.matchId);
    if (!match) {
      return null;
    }
    const teamIds = Object.keys(match?.scores).map((k) => parseInt(k));
    actionInfo.match = {
      matchId: payload.matchId,
      team1Name: state.teams.find((team) => team.id === teamIds[0])?.name,
      team1Id: teamIds[0],
      team2Name: state.teams.find((team) => team.id === teamIds[1])?.name,
      team2Id: teamIds[1],
    };
  }

  if (payloadKeys.includes("playerId")) {
    const player = state.players.find(
      (player) => player.id === payload.playerId
    );
    if (!player) {
      return null;
    }
    actionInfo.player = {
      playerName: player.name,
      playerId: payload.playerId,
    };
  }

  if (payloadKeys.includes("teamId")) {
    const team = state.teams.find((team) => team.id === payload.teamId);
    if (!team) {
      return null;
    }
    actionInfo.team = {
      teamName: team.name,
      teamId: payload.teamId,
    };
  }

  return Object.keys(actionInfo).length ? actionInfo : null;
};

export { signAsOperator, getActionInfo };
