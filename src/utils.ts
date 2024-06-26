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
  matchName?: string;
  teamName?: string;
  playerName?: string;
};

const getActionInfo = (payload: any, state: LeagueState): ActionInfo | null => {
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
    }

    if (key === "playerId") {
      const player = state.players.find(
        (player) => player.id === payload.playerId
      );
      if (!player) {
        return null;
      }
      actionInfo.playerName = player.name;
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

export { signAsOperator, getActionInfo };
