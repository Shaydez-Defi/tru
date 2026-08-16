import 'dotenv/config';
import { JsonRpcProvider, Wallet, ContractFactory } from 'ethers';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Deploy SpikeConsumer (Phase 0 throwaway) to Creditcoin CC3 Testnet via ethers.
// Uses the same ABI/bytecode forge produced, avoiding forge's Frontier simulation quirk.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const artifact = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../contracts/out/SpikeConsumer.sol/SpikeConsumer.json'),
    'utf8'
  )
);

const decoderAddress = process.env.DECODER_CONTRACT ?? '0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f';
const provider = new JsonRpcProvider(process.env.CREDITCOIN_RPC_URL);
const wallet = new Wallet(process.env.CREDITCOIN_PRIVATE_KEY, provider);

// forge (via_ir) artifacts store bytecode as {object, sourceMap, linkReferences}
const bytecode = typeof artifact.bytecode === 'string' ? artifact.bytecode : artifact.bytecode.object;

console.log('deploying SpikeConsumer from', wallet.address);
console.log('decoder contract  :', decoderAddress);

const factory = new ContractFactory(artifact.abi, bytecode, wallet);
const contract = await factory.deploy(decoderAddress);
const receipt = await contract.deploymentTransaction().wait();
console.log('SpikeConsumer at  :', await contract.getAddress());
console.log('deploy tx         :', contract.deploymentTransaction().hash);
console.log('gas used          :', receipt.gasUsed.toString());