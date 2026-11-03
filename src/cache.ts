import { Injectable } from "@nestjs/common";
type CachedResponse = { status: number; contentType: string; body: Buffer };
@Injectable()
export class PublicListCache {
  private readonly entries = new Map<
    string,
    { until: number; value: CachedResponse }
  >();
  private readonly pending = new Map<string, Promise<CachedResponse>>();
  private generation = 0;
  async get(
    key: string,
    load: () => Promise<CachedResponse>,
  ): Promise<CachedResponse> {
    const cached = this.entries.get(key);
    if (cached && cached.until > Date.now()) return cached.value;
    const inProgress = this.pending.get(key);
    if (inProgress) return inProgress;
    const generation = this.generation;
    let request: Promise<CachedResponse>;
    request = load()
      .then((value) => {
        if (
          value.status === 200 &&
          value.body.length <= 256 * 1024 &&
          generation === this.generation
        ) {
          if (this.entries.size >= 100)
            this.entries.delete(this.entries.keys().next().value!);
          this.entries.set(key, { until: Date.now() + 1000, value });
        }
        return value;
      })
      .finally(() => {
        if (this.pending.get(key) === request) this.pending.delete(key);
      });
    this.pending.set(key, request);
    return request;
  }
  clear() {
    this.generation++;
    this.entries.clear();
    this.pending.clear();
  }
}
