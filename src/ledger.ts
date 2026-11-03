import {
  Controller,
  Get,
  Injectable,
  Param,
  ServiceUnavailableException,
} from "@nestjs/common";
import amqp, { Channel, ChannelModel } from "amqplib";
import { readFile } from "node:fs/promises";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { z } from "zod";
import { canonical, Database, sha256, proofId } from "./core";

const eventSchema = z.object({
  id: z.uuid(),
  route_id: z.uuid(),
  version: z.number().int().positive(),
  proof_id: z.string().regex(/^0x[a-f0-9]{64}$/),
  digest: z.string().regex(/^0x[a-f0-9]{64}$/),
  payload: z.record(z.string(), z.unknown()),
});
export const checkEvent = (value: unknown) => {
  const event = eventSchema.parse(value);
  if (
    sha256(canonical(event.payload)) !== event.digest ||
    event.proof_id !== proofId(event.route_id, event.version) ||
    event.payload.route_id !== event.route_id ||
    event.payload.version !== event.version
  )
    throw new Error("Huella o identidad del evento inválida");
  return event;
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
@Injectable()
export class OutboxPublisher {
  private timer?: NodeJS.Timeout;
  private busy = false;
  private stopped = false;
  constructor(readonly db: Database) {}
  onModuleInit() {
    this.timer = setInterval(() => void this.flush(), 2000);
  }
  async flush() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    let connection: ChannelModel | undefined;
    try {
      connection = await amqp.connect(process.env.RABBITMQ_URL!);
      const ch = await connection.createConfirmChannel();
      await ch.assertQueue("proofs.dead", { durable: true });
      await ch.assertQueue("proofs", {
        durable: true,
        arguments: {
          "x-dead-letter-exchange": "",
          "x-dead-letter-routing-key": "proofs.dead",
        },
      });
      await this.db.tx(async (c) => {
        const batch = await c.query(
          "SELECT * FROM trails.outbox WHERE sent_at IS NULL ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED",
        );
        for (const event of batch.rows) {
          ch.sendToQueue("proofs", Buffer.from(JSON.stringify(event)), {
            persistent: true,
            messageId: event.id,
          });
          await ch.waitForConfirms();
          await c.query("UPDATE trails.outbox SET sent_at=now() WHERE id=$1", [
            event.id,
          ]);
        }
      });
      await ch.close();
    } catch (error: any) {
      console.error(
        "Outbox: envío pendiente; se reintentará",
        error?.code || "broker",
      );
    } finally {
      if (connection) await connection.close().catch(() => {});
      this.busy = false;
    }
  }
  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }
}
@Injectable()
export class LedgerService {
  connection?: ChannelModel;
  channel?: Channel;
  registry?: Contract;
  manifest: any;
  provider?: JsonRpcProvider;
  private stopped = false;
  constructor(readonly db: Database) {}
  onModuleInit() {
    void this.connect();
  }
  async connect() {
    while (!this.stopped) {
      try {
        this.manifest = JSON.parse(
          await readFile(
            process.env.DEPLOYMENT_FILE || "/app/deployments/local.json",
            "utf8",
          ),
        );
        this.provider = new JsonRpcProvider(process.env.RPC_URL);
        const network = await this.provider.getNetwork();
        if (Number(network.chainId) !== this.manifest.chain_id)
          throw new Error("La red no corresponde al contrato");
        const signer = process.env.SEPOLIA_PRIVATE_KEY
          ? new Wallet(process.env.SEPOLIA_PRIVATE_KEY, this.provider)
          : await this.provider.getSigner(0);
        this.registry = new Contract(
          this.manifest.address,
          this.manifest.abi,
          signer,
        );
        this.connection = await amqp.connect(process.env.RABBITMQ_URL!);
        this.channel = await this.connection.createChannel();
        await this.channel.assertQueue("proofs.dead", { durable: true });
        await this.channel.assertQueue("proofs", {
          durable: true,
          arguments: {
            "x-dead-letter-exchange": "",
            "x-dead-letter-routing-key": "proofs.dead",
          },
        });
        await this.channel.prefetch(1);
        const ch = this.channel;
        await ch.consume("proofs", async (message) => {
          if (!message) return;
          let event: ReturnType<typeof checkEvent>;
          try {
            event = checkEvent(JSON.parse(message.content.toString()));
          } catch {
            ch.nack(message, false, false);
            return;
          }
          try {
            await this.anchor(event);
            ch.ack(message);
          } catch (error: any) {
            console.error(
              "Ledger: prueba pendiente",
              error?.shortMessage || error?.code || "error",
            );
            await pause(2000);
            ch.nack(message, false, true);
          }
        });
        this.connection.on("close", () => {
          if (!this.stopped) {
            this.registry = undefined;
            void this.connect();
          }
        });
        return;
      } catch {
        await pause(2000);
      }
    }
  }
  async anchor(event: ReturnType<typeof checkEvent>) {
    const existing = await this.db.pool.query(
      "SELECT digest FROM ledger.proofs WHERE event_id=$1",
      [event.id],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].digest !== event.digest)
        throw new Error("Evento inconsistente");
      return;
    }
    const registry = this.registry!;
    let proof = await registry.proofs(event.proof_id);
    let txHash: string, block: number;
    if (proof.exists) {
      if (proof.digest !== event.digest)
        throw new Error("Prueba en cadena inconsistente");
      const logs = await registry.queryFilter(
        registry.filters.ProofRegistered(event.proof_id),
        this.manifest.block_number,
        "latest",
      );
      if (!logs[0]) throw new Error("No se encontró el recibo de la prueba");
      txHash = logs[0].transactionHash;
      block = logs[0].blockNumber;
    } else {
      const tx = await registry.register(event.proof_id, event.digest);
      const receipt = await tx.wait();
      txHash = receipt.hash;
      block = receipt.blockNumber;
    }
    await this.db.pool.query(
      "INSERT INTO ledger.proofs(event_id,route_id,version,proof_id,digest,transaction_hash,block_number,chain_id,contract_address) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(event_id) DO NOTHING",
      [
        event.id,
        event.route_id,
        event.version,
        event.proof_id,
        event.digest,
        txHash,
        block,
        this.manifest.chain_id,
        this.manifest.address,
      ],
    );
  }
  async live(proofId: string) {
    z.string()
      .regex(/^0x[a-fA-F0-9]{64}$/)
      .parse(proofId);
    if (!this.registry || !this.provider)
      throw new ServiceUnavailableException(
        "La conexión blockchain está iniciando",
      );
    const proof = await this.registry.proofs(proofId);
    const chain = await this.provider.getNetwork();
    return {
      proof_id: proofId,
      exists: proof.exists,
      digest: proof.digest,
      timestamp: proof.timestamp.toString(),
      registered_by: proof.registeredBy,
      chain_id: Number(chain.chainId),
      contract_address: this.manifest.address,
    };
  }
  async onModuleDestroy() {
    this.stopped = true;
    await this.channel?.close();
    await this.connection?.close();
    this.provider?.destroy();
  }
}
@Controller("api/proofs")
export class LedgerController {
  constructor(readonly ledger: LedgerService) {}
  @Get(":proofId") async live(@Param("proofId") proofId: string) {
    return this.ledger.live(proofId);
  }
}
