import { assertRdAuthorized, assertSameOrigin, rdError, rdRepository } from "../../_database";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try { assertRdAuthorized(request); return Response.json({ project: await rdRepository().getProject((await context.params).id) }); } catch (error) { return rdError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    assertRdAuthorized(request);
    assertSameOrigin(request);
    return Response.json({ project: await rdRepository().removeProject((await context.params).id) });
  } catch (error) { return rdError(error); }
}
