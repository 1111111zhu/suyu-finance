import { assertRdAuthorized, rdError, rdRepository } from "../_database";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await assertRdAuthorized(request);
    return Response.json({ rows: await rdRepository().listAnalysis() }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return rdError(error);
  }
}
