import { assertSameOrigin, rdError, rdRepository } from "../../_database";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try { return Response.json({ project: await rdRepository().getProject((await context.params).id) }); } catch (error) { return rdError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    return Response.json({ project: await rdRepository().removeProject((await context.params).id) });
  } catch (error) { return rdError(error); }
}
