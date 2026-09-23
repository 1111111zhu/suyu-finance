import { createPool } from "../../../database/payroll/pool.mjs";
import { createRdRepository } from "../../../database/rd/repository.mjs";
import { timingSafeEqual } from "node:crypto";

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
  if (code === "RD_AUTH_UNCONFIGURED") return Response.json({ error: "研发接口尚未配置访问密钥。" }, { status: 503 });
  if (code === "RD_UNAUTHORIZED") return Response.json({ error: "研发数据需要授权访问。" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (code === "RD_ORIGIN") return Response.json({ error: "请求来源不受信任。" }, { status: 403 });
  if (code === "RD_NOT_FOUND") return Response.json({ error: "未找到对应项目。" }, { status: 404 });
  if (code === "RD_CONFLICT" || code === "RD_IMPORT_CONFLICT") return Response.json({ error: "数据冲突，未保存任何更改。" }, { status: 409 });
  if (code === "RD_VALIDATION") return Response.json({ error: "提交的数据格式不正确。" }, { status: 422 });
  if (code === "RD_BATCH_VALIDATION") return Response.json({ error: error instanceof Error ? error.message : "费用归集校验失败。" }, { status: 422 });
  process.stderr.write(`RD API failed${code ? ` (${code})` : ""}.\n`);
  return Response.json({ error: "数据库暂时不可用，请稍后重试。" }, { status: 503 });
}

export async function jsonBody(request: Request) {
  try { return await request.json(); } catch { throw Object.assign(new Error("Invalid JSON"), { code: "RD_VALIDATION" }); }
}

/** A single server-side operational token protects the RD API until the UI's
 * user and role model is designed. Production fails closed when absent. */
export function assertRdAuthorized(request: Request) {
  const expected = process.env.RD_API_TOKEN;
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      throw Object.assign(new Error("RD API token not configured"), { code: "RD_AUTH_UNCONFIGURED" });
    }
    return;
  }
  const header = request.headers.get("authorization");
  const provided = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw Object.assign(new Error("RD API authorization required"), { code: "RD_UNAUTHORIZED" });
  }
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
