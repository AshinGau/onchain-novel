import chalk from "chalk";
import { Command } from "commander";
import { parseEther } from "viem";

import {
  buildWorldLineProof,
  getRule,
  getRuleNames,
  getRuleProposal,
  proposeRule as proposeRuleTx,
  setCreatorRules as setCreatorRulesTx,
  voteOnRuleProposal as voteOnRuleProposalTx,
} from "../shared/index.js";
import { fetchNovelConfig } from "../utils/api.js";
import { getContracts, getPublicClient, getWalletClient, waitForTx } from "../utils/client.js";
import { error, header, kv, success, txHash } from "../utils/format.js";

export function registerRuleCommands(program: Command): void {
  const rule = program.command("rule").description("World-building rules commands");

  rule
    .command("list <novel-id>")
    .description("List all rules for a novel")
    .action(async (novelId) => {
      try {
        const client = getPublicClient();
        const rulesEngine = getContracts().rulesEngine;

        const names = await getRuleNames(client, BigInt(novelId), rulesEngine);
        header(`Rules — Novel #${novelId}`);

        if (names.length === 0) {
          console.log(chalk.gray("  (no rules set)"));
          console.log();
          return;
        }

        for (const name of names) {
          const content = await getRule(client, BigInt(novelId), name, rulesEngine);
          console.log(chalk.bold(`  ${name}:`));
          console.log(`    ${content}`);
          console.log();
        }
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  rule
    .command("set <novel-id> <name> <content>")
    .description("Set a creator rule (only before first round, creator only)")
    .action(async (novelId, name, content) => {
      try {
        const client = getWalletClient();
        const rulesEngine = getContracts().rulesEngine;
        const hash = await setCreatorRulesTx(client, {
          novelId: BigInt(novelId),
          names: [name],
          contents: [content],
          rulesEngine,
        });
        txHash(hash);
        await waitForTx(hash);
        success(`Rule "${name}" set`);
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  rule
    .command("propose <novel-id> <action> <name> <chapter-id> [content]")
    .description(
      "Propose adding or deleting a rule (action: add|delete). " +
        "<chapter-id> is one of your authored chapters that's currently on a world line — " +
        "the path proof is computed automatically.",
    )
    .option("--value <eth>", "rule proposal fee in ETH")
    .action(async (novelId, action, name, chapterId, content, opts) => {
      try {
        if (action !== "add" && action !== "delete") {
          error("Action must be 'add' or 'delete'");
          return process.exit(1);
        }
        if (action === "add" && !content) {
          error("Content is required for 'add' proposals");
          return process.exit(1);
        }

        const wallet = getWalletClient();
        const pub = getPublicClient();
        const contracts = getContracts();
        const rulesEngine = contracts.rulesEngine;

        let value: bigint;
        if (opts.value) {
          value = parseEther(opts.value);
        } else {
          const { config } = await fetchNovelConfig(novelId);
          value = BigInt(config.ruleFee ?? "0");
        }

        const path = await buildWorldLineProof(
          pub,
          contracts.novelCore,
          BigInt(novelId),
          BigInt(chapterId),
        );
        if (!path) {
          error(`Chapter #${chapterId} is not currently on any world line of novel #${novelId}.`);
          return process.exit(1);
        }

        const proposalType = action === "add" ? 0 : 1;
        const hash = await proposeRuleTx(wallet, {
          novelId: BigInt(novelId),
          proposalType,
          ruleName: name,
          ruleContent: content ?? "",
          path,
          value,
          rulesEngine,
        });
        txHash(hash);
        await waitForTx(hash);
        success(`Rule proposal created: ${action} "${name}"`);
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  rule
    .command("vote <proposal-id> <chapter-id>")
    .description(
      "Vote on a rule proposal. <chapter-id> is one of your authored chapters that's currently " +
        "on a world line — the path proof is computed automatically.",
    )
    .action(async (proposalId, chapterId) => {
      try {
        const wallet = getWalletClient();
        const pub = getPublicClient();
        const contracts = getContracts();
        const rulesEngine = contracts.rulesEngine;

        // Derive the novelId from the proposal so we can build the path
        const proposal = await getRuleProposal(pub, BigInt(proposalId), rulesEngine);
        const path = await buildWorldLineProof(
          pub,
          contracts.novelCore,
          proposal.novelId,
          BigInt(chapterId),
        );
        if (!path) {
          error(
            `Chapter #${chapterId} is not currently on any world line of novel #${proposal.novelId}.`,
          );
          return process.exit(1);
        }

        const hash = await voteOnRuleProposalTx(wallet, {
          proposalId: BigInt(proposalId),
          path,
          rulesEngine,
        });
        txHash(hash);
        await waitForTx(hash);
        success("Voted on rule proposal");
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  rule
    .command("proposal <proposal-id>")
    .description("Show details of a rule proposal")
    .action(async (proposalId) => {
      try {
        const client = getPublicClient();
        const rulesEngine = getContracts().rulesEngine;
        const proposal = await getRuleProposal(client, BigInt(proposalId), rulesEngine);
        header(`Rule Proposal #${proposalId}`);
        kv("Novel", proposal.novelId.toString());
        kv("Proposer", proposal.proposer);
        kv("Type", proposal.proposalType === 0 ? "Add" : "Delete");
        kv("Rule Name", proposal.ruleName);
        if (proposal.ruleContent) {
          kv("Rule Content", proposal.ruleContent);
        }
        kv("Vote Count", proposal.voteCount.toString());
        kv("Executed", proposal.executed ? "Yes" : "No");
        kv("Created At", new Date(Number(proposal.createdAt) * 1000).toISOString());
        console.log();
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });
}
