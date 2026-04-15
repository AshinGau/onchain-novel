"use client";

import { useQuery } from "@tanstack/react-query";

import { fetchNicknamesBatch } from "@/lib/api";
import { shortAddress } from "@/lib/format";

/**
 * Resolve a list of addresses to display names (nickname or short address).
 * Returns a lookup function: displayName(address) => string
 */
export function useNicknames(addresses: string[]) {
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()))];

  const { data } = useQuery({
    queryKey: ["nicknames", unique.join(",")],
    queryFn: async () => {
      if (unique.length === 0) return {};
      const { nicknames } = await fetchNicknamesBatch(unique);
      return nicknames;
    },
    enabled: unique.length > 0,
    staleTime: 60_000,
  });

  function displayName(address: string): string {
    const nick = data?.[address.toLowerCase()];
    return nick || shortAddress(address);
  }

  return displayName;
}
