import { assertRdAuthorized, rdError, rdRepository } from "../_database";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await assertRdAuthorized(request);
    return Response.json({ totals: await rdRepository().listMonthlyTotals() });
  } catch (error) {
    return rdError(error);
  }
}
