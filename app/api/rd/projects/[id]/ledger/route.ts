import { rdError, rdRepository } from "../../../_database";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try { return Response.json({ ledger: await rdRepository().listLedger((await context.params).id) }); } catch (error) { return rdError(error); }
}
