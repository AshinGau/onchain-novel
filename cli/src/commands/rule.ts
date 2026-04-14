import { Command } from "commander";
import { parseEther } from "viem";
import {
  setCreatorRules as setCreatorRulesTx,
  proposeRule as proposeRuleTx,
  voteOnRuleProposal as voteOnRuleProposalTx,
  buildWorldLineProof,
  getRuleNames,
  getRule,
  getRuleProposal,
} from "../shared/index.js";
import { getWalletClient, getPublicClient, getContracts, waitForTx } from "../utils/client.js";
import { apiGet } from "../utils/api.js";
import { header, kv, success, error, txHash } from "../utils/format.js";
import chalk from "chalk";

function requireRulesEngine(contracts: ReturnType<typeof getContracts>): `0x${string}` {
  if (!contracts.rulesEngine) {
    error("RulesEngine contract address not configured. Run 'onchain-novel-cli config set contracts.rulesEngine <address>'.");
    return process.exit(1);
  }
  return contracts.rulesEngine;
}

export function registerRuleCommands(program: Command): void {
  const rule = program.command("rule").description("World-building rules commands");

  rule
    .command("list <novel-id>")
    .description("List all rules for a novel")
    .action(async (novelId) => {
      try {
        const client = getPublicClient();
        const rulesEngine = requireRulesEngine(getContracts());

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
        const rulesEngine = requireRulesEngine(getContracts());
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
        const rulesEngine = requireRulesEngine(contracts);

        let value: bigint;
        if (opts.value) {
          value = parseEther(opts.value);
        } else {
          try {
            const novel = await apiGet<Record<string, unknown>>(`/api/novels/${novelId}`);
            const config = novel.config as Record<string, string>;
            value = BigInt(config.ruleFee ?? "0");
          } catch {
            value = parseEther("0.001");
            console.log(chalk.yellow(`  Could not fetch novel config. Using default fee: 0.001 ETH`));
          }
        }

        const path = await buildWorldLineProof(pub, contracts.novelCore, BigInt(novelId), BigInt(chapterId));
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
        const rulesEngine = requireRulesEngine(contracts);

        // Derive the novelId from the proposal so we can build the path
        const proposal = await getRuleProposal(pub, BigInt(proposalId), rulesEngine);
        const path = await buildWorldLineProof(pub, contracts.novelCore, proposal.novelId, BigInt(chapterId));
        if (!path) {
          error(`Chapter #${chapterId} is not currently on any world line of novel #${proposal.novelId}.`);
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
        const rulesEngine = requireRulesEngine(getContracts());
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
