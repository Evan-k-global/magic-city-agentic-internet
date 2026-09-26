import { toUnits } from './units.js';

const fail = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
const address = (value) => String(value || '').trim().toLowerCase();
const validAddress = (value) => /^0x[\da-f]{40}$/.test(address(value));
export function assertPreparedPaymentSubmission(authorization, body, authUserId, transactionOwner = null) {
  if (!authorization || !body.requestId || authorization.requestId !== body.requestId || authorization.userId !== authUserId) throw fail('payment_request_not_found', 404);
  if (authorization.metadata?.source !== 'wallet_request') throw fail('prepared_payment_request_required');
  for (const key of ['mode', 'chainId', 'recipientAddress', 'senderAddress', 'tokenAddress', 'amountUsdCents', 'amountBaseUnits', 'credits']) {
    if (body[key] === undefined || body[key] === null) continue;
    const expected = authorization[key];
    const normalize = key.endsWith('Address') ? address : (value) => String(value);
    if (expected == null || normalize(body[key]) !== normalize(expected)) throw fail(`payment_terms_mismatch:${key}`);
  }
  const txHash = address(body.txHash);
  if (!/^0x[\da-f]{64}$/.test(txHash)) throw fail('invalid_transaction_hash', 400);
  if (transactionOwner && transactionOwner.id !== authorization.id) throw fail('transaction_already_assigned');
  if (authorization.walletTxHash && address(authorization.walletTxHash) !== txHash) throw fail('payment_transaction_already_bound');
  if (['failed', 'cancelled', 'rejected'].includes(authorization.authorizationState)) throw fail('payment_authorization_terminal');
  return { txHash, replay: Boolean(authorization.walletTxHash) };
}
export function validTopupTransfer(authorization, observed, chain, creditsToCents) {
  if (authorization?.metadata?.source !== 'wallet_request' || observed?.matched !== true) return false;
  const credits = Number(authorization.credits);
  const cents = Number(authorization.amountUsdCents);
  if (!Number.isSafeInteger(credits) || credits < 1 || !Number.isSafeInteger(toUnits(credits)) || !Number.isSafeInteger(cents) || cents < 1 || creditsToCents(credits) !== cents) return false;
  if (![authorization.senderAddress, chain.treasuryAddress, chain.tokenAddress].every(validAddress)) return false;
  if (address(authorization.recipientAddress) !== address(chain.treasuryAddress) || address(authorization.tokenAddress) !== address(chain.tokenAddress)) return false;
  return Number(authorization.chainId) === Number(chain.chainId)
    && /^0x[\da-f]{64}$/.test(address(authorization.walletTxHash))
    && address(observed.transactionHash) === address(authorization.walletTxHash)
    && address(observed.tokenAddress) === address(chain.tokenAddress)
    && address(observed.from) === address(authorization.senderAddress)
    && address(observed.to) === address(chain.treasuryAddress)
    && String(observed.value) === String(authorization.amountBaseUnits)
    && String(observed.value) === String(BigInt(cents) * 10000n);
}
