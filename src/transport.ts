import { Injectable, ServiceUnavailableException } from "@nestjs/common";
type State = { failures: number; openUntil: number; probing: boolean };
@Injectable()
export class ResilientHttp {
  private readonly circuits = new Map<string, State>();
  async request(
    service: string,
    url: string,
    options: RequestInit = {},
    timeout = 5000,
  ): Promise<globalThis.Response> {
    const state = this.circuits.get(service) || {
      failures: 0,
      openUntil: 0,
      probing: false,
    };
    this.circuits.set(service, state);
    if (state.openUntil > Date.now() || (state.openUntil && state.probing))
      throw new ServiceUnavailableException(
        `Servicio ${service} temporalmente no disponible`,
      );
    if (state.openUntil) state.probing = true;
    try {
      const result = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(timeout),
        redirect: "error",
      });
      if (result.status >= 500) this.fail(state);
      else {
        state.failures = 0;
        state.openUntil = 0;
      }
      return result;
    } catch {
      this.fail(state);
      throw new ServiceUnavailableException(
        `No se pudo contactar al servicio ${service}`,
      );
    } finally {
      state.probing = false;
    }
  }
  private fail(s: State) {
    s.failures++;
    if (s.failures >= 5) s.openUntil = Date.now() + 15000;
  }
}
