import { createPool } from "../../../database/payroll/pool.mjs";
import { createRdRepository } from "../../../database/rd/repository.mjs";

type RdRuntime = {
  repository: ReturnType<typeof createRdRepository>;
};

const runtimeState = globalThis as typeof globalThis & { __suyuRdRuntime?: RdRuntime };

export function rdRepository() {
  if (!process.env.RD_DATABASE_URL) {
    throw Object.assign(new Error("研发数据库尚未配置。"), { code: "RD_UNCONFIGURED" });
  }
  if (!runtimeState.__suyuRdRuntime) {
    const pool = createPool({
      connectionString: process.env.RD_DATABASE_URL,
      application_name: "suyu-rd-web",
      max: 10,
    });
    pool.on("error", () => process.stderr.write("RD database connection interrupted.\n"));
    runtimeState.__suyuRdRuntime = { repository: createRdRepository(pool) };
  }
  return runtimeState.__suyuRdRuntime.repository;
}

export function rdError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code === "RD_UNCONFIGURED") return Response.json({ error: "研发数据库尚未配置。" }, { status: 503 });
  if (code === "RD_ORIGIN") return Response.json({ error: "请求来源不受信任。" }, { status: 403 });
  if (code === "RD_NOT_FOUND") return Response.json({ error: "未找到对应项目。" }, { status: 404 });
  if (code === "RD_CONFLICT" || code === "RD_IMPORT_CONFLICT") return Response.json({ error: "数据冲突，未保存任何更改。" }, { status: 409 });
  if (code === "RD_VALIDATION") return Response.json({ error: "提交的数据格式不正确。" }, { status: 422 });
  process.stderr.write(`RD API failed${code ? ` (${code})` : ""}.\n`);
  return Response.json({ error: "数据库暂时不可用，请稍后重试。" }, { status: 503 });
}

export async function jsonBody(request: Request) {
  try { return await request.json(); } catch { throw Object.assign(new Error("Invalid JSON"), { code: "RD_VALIDATION" }); }
}

/** Browser mutations must originate from this same site.  Requests without an
 * Origin header are permitted for non-browser operational clients. */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol ?? new URL(request.url).protocol.slice(0, -1);
  try {
    const parsed = new URL(origin);
    if (!host || parsed.host !== host || parsed.protocol !== `${protocol}:`) throw new Error("origin mismatch");
  } catch {
    throw Object.assign(new Error("Untrusted request origin"), { code: "RD_ORIGIN" });
  }
}
