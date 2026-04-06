/** Native token symbol, configurable per deployment (e.g. "ETH", "MATIC", "AVAX") */
export const TOKEN_SYMBOL = process.env.NEXT_PUBLIC_TOKEN_SYMBOL || "ETH";

/** Default stake amount for voting/tipping inputs */
export const DEFAULT_STAKE = process.env.NEXT_PUBLIC_DEFAULT_STAKE || "0.01";
