import { randomUUID } from "node:crypto";
import { canonical, proofId, sha256 } from "../src/core";
import { checkEvent, LedgerService, OutboxPublisher } from "../src/ledger";
import { readFile } from "node:fs/promises";
import amqp from "amqplib";
import { Contract, JsonRpcProvider } from "ethers";
jest.mock("node:fs/promises", () => ({ readFile: jest.fn() }));
jest.mock("amqplib", () => ({
  __esModule: true,
  default: { connect: jest.fn() },
}));
jest.mock("ethers", () => ({
  Contract: jest.fn(),
  JsonRpcProvider: jest.fn(),
  Wallet: jest.fn(),
}));
const event = () => {
  const route = randomUUID();
  const payload = { route_id: route, version: 1, name: "ruta pública" };
  return {
    id: randomUUID(),
    route_id: route,
    version: 1,
    proof_id: proofId(route, 1),
    digest: sha256(canonical(payload)),
    payload,
  };
};
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});
test("valida huella e identidad para rechazar mensajes inconsistentes", () => {
  const e = event();
  expect(checkEvent(e)).toEqual(e);
  expect(() => checkEvent({ ...e, digest: sha256("otro") })).toThrow();
  expect(() => checkEvent({ ...e, proof_id: sha256("otro") })).toThrow();
  expect(() => checkEvent({ id: "invalid" })).toThrow();
});
test("outbox confirma publicación antes de marcar enviado y reintenta fallas", async () => {
  const e = event(),
    q = jest
      .fn()
      .mockResolvedValueOnce({ rows: [e] })
      .mockResolvedValue({ rows: [] });
  const db: any = { tx: async (fn: any) => fn({ query: q }) };
  const channel = {
    assertQueue: jest.fn(),
    sendToQueue: jest.fn(),
    waitForConfirms: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const connection = {
    createConfirmChannel: jest.fn().mockResolvedValue(channel),
    close: jest.fn().mockResolvedValue(undefined),
  };
  (amqp.connect as jest.Mock).mockResolvedValue(connection);
  const p = new OutboxPublisher(db);
  p.onModuleInit();
  await p.flush();
  expect(channel.sendToQueue).toHaveBeenCalled();
  expect(q).toHaveBeenCalledWith(
    "UPDATE trails.outbox SET sent_at=now() WHERE id=$1",
    [e.id],
  );
  expect(connection.close).toHaveBeenCalled();
  (amqp.connect as jest.Mock).mockRejectedValueOnce(new Error("offline"));
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  await p.flush();
  expect(log).toHaveBeenCalled();
  p.onModuleDestroy();
  await p.flush();
});
test("registra recibos y hace idempotentes las entregas repetidas", async () => {
  const e = event();
  const query = jest.fn().mockResolvedValue({ rows: [] });
  const ledger = new LedgerService({ pool: { query } } as any);
  ledger.manifest = { chain_id: 31337, address: "0xregistry", block_number: 1 };
  const registry: any = {
    proofs: jest.fn().mockResolvedValue({ exists: false }),
    register: jest
      .fn()
      .mockResolvedValue({
        wait: async () => ({ hash: "0xtx", blockNumber: 2 }),
      }),
  };
  ledger.registry = registry;
  await ledger.anchor(e);
  expect(registry.register).toHaveBeenCalledWith(e.proof_id, e.digest);
  expect(query.mock.calls[1][1]).toContain("0xtx");
  query.mockResolvedValue({ rows: [{ digest: e.digest }] });
  await ledger.anchor(e);
  expect(registry.register).toHaveBeenCalledTimes(1);
  query.mockResolvedValue({ rows: [{ digest: sha256("wrong") }] });
  await expect(ledger.anchor(e)).rejects.toThrow("inconsistente");
});
test("recupera recibo tras fallo posterior a la transacción y detecta divergencias", async () => {
  const e = event();
  const ledger = new LedgerService({
    pool: { query: jest.fn().mockResolvedValue({ rows: [] }) },
  } as any);
  ledger.manifest = { chain_id: 31337, address: "0xregistry", block_number: 1 };
  const registry: any = {
    proofs: jest.fn().mockResolvedValue({ exists: true, digest: e.digest }),
    filters: { ProofRegistered: jest.fn() },
    queryFilter: jest
      .fn()
      .mockResolvedValue([{ transactionHash: "0xold", blockNumber: 3 }]),
  };
  ledger.registry = registry;
  await expect(ledger.anchor(e)).resolves.toBeUndefined();
  registry.proofs.mockResolvedValue({ exists: true, digest: sha256("wrong") });
  await expect(ledger.anchor(e)).rejects.toThrow("inconsistente");
  registry.proofs.mockResolvedValue({ exists: true, digest: e.digest });
  registry.queryFilter.mockResolvedValue([]);
  await expect(ledger.anchor(e)).rejects.toThrow("recibo");
});
test("consulta prueba directamente en cadena y señala inicio incompleto", async () => {
  const ledger = new LedgerService({} as any),
    e = event();
  await expect(ledger.live(e.proof_id)).rejects.toThrow("iniciando");
  await expect(ledger.live("invalid")).rejects.toThrow();
  ledger.manifest = { address: "0xregistry" };
  ledger.provider = { getNetwork: async () => ({ chainId: 31337n }) } as any;
  ledger.registry = {
    proofs: async () => ({
      exists: true,
      digest: e.digest,
      timestamp: 123n,
      registeredBy: "0xowner",
    }),
  } as any;
  expect(await ledger.live(e.proof_id)).toMatchObject({
    exists: true,
    digest: e.digest,
    chain_id: 31337,
    timestamp: "123",
  });
});
test("consumidor confirma solo después de persistir y descarta mensajes inválidos", async () => {
  const e = event();
  let callback: any;
  const channel = {
    assertQueue: jest.fn(),
    prefetch: jest.fn(),
    consume: jest.fn().mockImplementation(async (_: string, cb: any) => {
      callback = cb;
    }),
    ack: jest.fn(),
    nack: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const connection = {
    createChannel: jest.fn().mockResolvedValue(channel),
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };
  (amqp.connect as jest.Mock).mockResolvedValue(connection);
  (readFile as jest.Mock).mockResolvedValue(
    JSON.stringify({ chain_id: 31337, address: "0xregistry", abi: [] }),
  );
  const provider = {
    getNetwork: async () => ({ chainId: 31337n }),
    getSigner: async () => ({}),
    destroy: jest.fn(),
  };
  (JsonRpcProvider as unknown as jest.Mock).mockReturnValue(provider);
  (Contract as unknown as jest.Mock).mockReturnValue({});
  const ledger = new LedgerService({} as any);
  const anchor = jest.spyOn(ledger, "anchor").mockResolvedValue(undefined);
  await ledger.connect();
  await callback(null);
  const message = { content: Buffer.from(JSON.stringify(e)) };
  await callback(message);
  expect(channel.ack).toHaveBeenCalledWith(message);
  await callback({ content: Buffer.from("bad") });
  expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, false);
  jest.useFakeTimers();
  anchor.mockRejectedValue(new Error("offline"));
  jest.spyOn(console, "error").mockImplementation(() => {});
  const pending = callback(message);
  await Promise.resolve();
  await jest.advanceTimersByTimeAsync(2000);
  await pending;
  expect(channel.nack).toHaveBeenCalledWith(message, false, true);
  await ledger.onModuleDestroy();
  expect(provider.destroy).toHaveBeenCalled();
});
