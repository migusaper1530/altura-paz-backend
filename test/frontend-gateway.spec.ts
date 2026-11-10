import { GatewayController } from "../src/gateway";
import { PublicListCache } from "../src/cache";
import { NotFoundException } from "@nestjs/common";

const controller = new GatewayController({} as any, new PublicListCache());
function response() {
  const result: any = {};
  result.type = jest.fn().mockReturnValue(result);
  result.setHeader = jest.fn().mockReturnValue(result);
  result.send = jest.fn();
  return result;
}
test("el gateway entrega la aplicación y sus módulos con el tipo correcto", async () => {
  const index = response(); await controller.index(index);
  expect(index.send.mock.calls[0][0].toString()).toContain('id="route-list"');
  for (const [path, type] of [["/app.mjs", "application/javascript"], ["/app.css", "text/css"], ["/assets/montana.svg", "image/svg+xml"]]) {
    const res = response(); await controller.frontend({ path } as any, res);
    expect(res.type).toHaveBeenCalledWith(type);
    expect(res.send.mock.calls[0][0].length).toBeGreaterThan(0);
  }
});
test("los recursos estáticos no permiten leer secretos, salir de public ni abrir archivos ausentes", async () => {
  for (const path of ["/assets/../../.env", "/assets/%2e%2e/%2e%2e/.env", "/assets/CREDITS.md", "/assets/not-present.webp"]) {
    await expect(controller.frontend({ path } as any, response())).rejects.toBeInstanceOf(NotFoundException);
  }
});
