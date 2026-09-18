import { assertSameOrigin, jsonBody, rdError, rdRepository } from "../_database";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    return Response.json(await rdRepository().importLegacy(await jsonBody(request)), { status: 201 });
  } catch (error) { return rdError(error); }
}
