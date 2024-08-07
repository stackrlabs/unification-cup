import { keccak256, ZeroHash } from "ethers";
import { MerkleTree } from "merkletreejs";

export interface MTResponse {
  rootHash: string;
  merkleProof: (leaf: string) =>
    | {
        root: string;
        proof: string[];
      }
    | undefined;
  verifyProof: (leaf: string, proof: string[]) => boolean;
}

/**
 * @param items List of items to be included in the Merkle Tree
 * @param serializer Optional function to serialize the items
 * @returns `MTResponse` object
 */
export const createMT = <ConvertibleItem>(
  items: ConvertibleItem[],
  serializer?: (item: ConvertibleItem) => string
): MTResponse => {
  const mt = new MerkleTree(
    serializer ? items.map(serializer) : items,
    keccak256,
    {
      hashLeaves: false,
      sortLeaves: true,
      sortPairs: true,
    }
  );

  const hexRoot = mt.getHexRoot();
  const rootHash = hexRoot === "0x" ? ZeroHash : hexRoot;

  return {
    rootHash,
    merkleProof: (leaf: string) => {
      const proof = mt.getHexProof(leaf);
      if (proof.length === 0) {
        return undefined;
      }
      return {
        root: rootHash,
        proof,
      };
    },
    verifyProof: (leaf: string, proof: string[]): boolean => {
      try {
        return mt.verify(proof, leaf, mt.getRoot());
      } catch (error) {
        return false;
      }
    },
  };
};
