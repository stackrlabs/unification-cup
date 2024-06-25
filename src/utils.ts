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
  matchId?: number;
  teamId?: number;
  playerId?: number;
  teamName?: string;
  playerName?: string;
};

const getActionInfo = (
  actionName: string,
  payload: any,
  state: LeagueState
): ActionInfo | null => {
  if (actionName === "startMatch" || actionName === "endMatch") {
    return {
      matchId: payload.matchId,
    };
  } else if (
    actionName === "recordGoal" ||
    actionName === "removeGoal" ||
    actionName === "logGoalSaved" ||
    actionName === "logPenalty" ||
    actionName === "logFoul"
  ) {
    const playerName = state.players.find(
      (player) => player.id === payload.playerId
    )?.name;
    return {
      matchId: payload.matchId,
      playerId: payload.playerId,
      playerName: playerName,
    };
  } else if (actionName === "logByes") {
    const teamName = state.teams.find(
      (team) => team.id === payload.teamId
    )?.name;
    return {
      teamId: payload.teamId,
      teamName: teamName,
    };
  } else {
    return null;
  }
};

export { signAsOperator, getActionInfo };
