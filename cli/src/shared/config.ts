export interface OnchainNovelConfig {
  rpcUrl: string;
  privateKey?: string;
  apiUrl?: string;
  chainId?: number;
  contracts: {
    novelCore: `0x${string}`;
    votingEngine?: `0x${string}`;
    prizePool?: `0x${string}`;
    bountyBoard?: `0x${string}`;
    rulesEngine?: `0x${string}`;
  };
}
