import './compile-contract.mjs';
import {ContractFactory,JsonRpcProvider,Wallet} from 'ethers';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const sepolia=process.argv.includes('--sepolia');
const rpc=sepolia?process.env.SEPOLIA_RPC_URL:process.env.RPC_URL||'http://127.0.0.1:8545';
if(!rpc || (sepolia&&!process.env.SEPOLIA_PRIVATE_KEY))throw new Error('Configura SEPOLIA_RPC_URL y SEPOLIA_PRIVATE_KEY mediante variables de entorno');
const provider=new JsonRpcProvider(rpc);const network=await provider.getNetwork();
const expected=sepolia?11155111:31337;if(Number(network.chainId)!==expected)throw new Error(`Red incorrecta: se esperaba ${expected}`);
const path=sepolia?'deployments/sepolia.json':'deployments/local.json';
if(existsSync(path)) {
  const saved=JSON.parse(readFileSync(path,'utf8'));
  if(saved.chain_id===expected && await provider.getCode(saved.address)!=='0x'){
    console.log(JSON.stringify({status:'already_deployed',chain_id:expected,address:saved.address}));provider.destroy();process.exit(0);
  }
}
const signer=sepolia?new Wallet(process.env.SEPOLIA_PRIVATE_KEY,provider):await provider.getSigner(0);
const artifact=JSON.parse(readFileSync('deployments/artifact.json','utf8'));const owner=await signer.getAddress();
const registry=await new ContractFactory(artifact.abi,artifact.bytecode,signer).deploy(owner);await registry.waitForDeployment();
const receipt=await registry.deploymentTransaction().wait();const manifest={chain_id:expected,address:await registry.getAddress(),owner,transaction_hash:receipt.hash,block_number:receipt.blockNumber,abi:artifact.abi};
writeFileSync(path,JSON.stringify(manifest,null,2));
console.log(JSON.stringify({network:sepolia?'Sepolia':'EVM local',chain_id:expected,address:manifest.address,transaction_hash:receipt.hash}));provider.destroy();
