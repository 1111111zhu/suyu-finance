import { assertRdAuthorized, assertSameOrigin, jsonBody, rdError, rdRepository } from "../_database";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertRdAuthorized(request);
    assertSameOrigin(request);
    return Response.json({ ledger: await rdRepository().recordCalculation(await jsonBody(request)) });
  } catch (error) { return rdError(error); }
}
