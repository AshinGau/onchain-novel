import { Command } from "commander";
import { parseEther } from "viem";
import {
  setCreatorRules as setCreatorRulesTx,
  proposeRule as proposeRuleTx,
  voteOnRuleProposal as voteOnRuleProposalTx,
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
    .command("propose <novel-id> <action> <name> [content]")
    .description("Propose adding or deleting a rule (action: add|delete)")
    .option("--value <eth>", "rule proposal fee in ETH")
    .action(async (novelId, action, name, content, opts) => {
      try {
        if (action !== "add" && action !== "delete") {
          error("Action must be 'add' or 'delete'");
          return process.exit(1);
        }
        if (action === "add" && !content) {
          error("Content is required for 'add' proposals");
          return process.exit(1);
        }

        const client = getWalletClient();
        const rulesEngine = requireRulesEngine(getContracts());

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

        const proposalType = action === "add" ? 0 : 1;
        const hash = await proposeRuleTx(client, {
          novelId: BigInt(novelId),
          proposalType,
          ruleName: name,
          ruleContent: content ?? "",
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
    .command("vote <proposal-id>")
    .description("Vote on a rule proposal (world-line authors only)")
    .action(async (proposalId) => {
      try {
        const client = getWalletClient();
        const rulesEngine = requireRulesEngine(getContracts());
        const hash = await voteOnRuleProposalTx(client, BigInt(proposalId), rulesEngine);
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
