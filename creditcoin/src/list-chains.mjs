import 'dotenv/config';
import { JsonRpcProvider } from 'ethers';
import { chainInfo } from '@gluwa/usc-sdk';

// Query which source chains the CC3 testnet currently supports (live).
const provider = new JsonRpcProvider(process.env.CREDITCOIN_RPC_URL);
const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(provider);

const chains = await chainInfoProvider.getSupportedChains();
console.log('Supported source chains on Creditcoin:');
for (const c of chains) {
  console.log(
    `  chainKey=${c.chainKey} chainId=${c.chainId} chainName="${c.chainName}" chainEncoding=${c.chainEncoding}`
  );
}