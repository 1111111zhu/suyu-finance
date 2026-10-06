import { assertRdAuthorized, assertSameOrigin, rdError } from "../_database";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await assertRdAuthorized(request);
    assertSameOrigin(request);
    return Response.json({ error: "费用必须经过月度复核并确认后入账。" }, { status: 410 });
  } catch (error) { return rdError(error); }
}
