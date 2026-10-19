/**
 * Transaction building for approve/reject actions.
 * Zero dependencies — uses hand-rolled transaction serialization.
 */
import { PROGRAM_ID, APPROVE_DISC, REJECT_DISC, getProposalPda, decodeBase58, encodeBase58 } from './squads.js';
import { serializeTransactionMessage, buildUnsignedTransaction, AccountRole } from './transaction.js';
import { fetchLatestBlockhash } from './rpc.js';

/**
 * Build a vote (approve or reject) transaction as Uint8Array for wallet signing.
 */
export async function buildVoteTransaction(multisigAddress, memberAddress, transactionIndex, approve, rpcUrl) {
  const [proposalPdaBytes] = await getProposalPda(multisigAddress, transactionIndex);
  const proposalPda = encodeBase58(proposalPdaBytes);

  // Build instruction data: [8B discriminator][1B None memo (0x00)]
  const disc = approve ? APPROVE_DISC : REJECT_DISC;
  const data = new Uint8Array(9);
  data.set(disc, 0);
  data[8] = 0x00; // None memo

  const instruction = {
    programId: decodeBase58(PROGRAM_ID),
    accounts: [
      { pubkey: decodeBase58(multisigAddress), role: AccountRole.READONLY },
      { pubkey: decodeBase58(memberAddress), role: AccountRole.READONLY_SIGNER },
      { pubkey: proposalPdaBytes, role: AccountRole.WRITABLE },
    ],
    data,
  };

  // Fetch blockhash
  const { blockhash } = await fetchLatestBlockhash(rpcUrl);

  // Serialize message
  const messageBytes = serializeTransactionMessage({
    feePayer: decodeBase58(memberAddress),
    recentBlockhash: decodeBase58(blockhash),
    instructions: [instruction],
  });

  // Wrap as unsigned transaction (1 signer = fee payer)
  return buildUnsignedTransaction(messageBytes, 1);
}
