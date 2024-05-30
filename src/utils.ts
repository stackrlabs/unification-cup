import { ethers } from "ethers";
import { schemas } from "./stackr/actions";
import { stackrConfig } from "../stackr.config";

/**
 * Sign and submit action as operator
 * @param transitionName
 * @param inputs
 * @returns signed action
 */
const signAsOperator = async (transitionName: string, inputs: any) => {
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY as string);
  const schemaName = transitionName as keyof typeof schemas;
  const actionSchema = schemas[schemaName];

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
