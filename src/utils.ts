import { MicroRollupResponse } from "@stackr/sdk";
import { ethers } from "ethers";
import { stfSchemaMap } from ".";
import { stackrConfig } from "../stackr.config";
import { schemas } from "./stackr/actions";
import { LeagueMachine } from "./stackr/machines";

export const canAddressSubmitAction = (
  mru: MicroRollupResponse,
  address: string
): boolean => {
  const { admins } = mru.stateMachines.getFirst<LeagueMachine>().state;
  return admins.includes(address);
};

/**
 * Sign and submit action as operator
 * @param transitionName
 * @param inputs
 * @returns signed action
 */
export const signAsOperator = async (schemaName: string, inputs: any) => {
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
