import { ethers } from "ethers";
import { schemas } from "./stackr/actions";
import { stackrConfig } from "../stackr.config";
import { stfSchemaMap } from ".";

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

export { signAsOperator };
