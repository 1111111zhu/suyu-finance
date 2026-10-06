import { assertRdAuthorized, assertSameOrigin, jsonBody, rdError, rdRepository } from "../../_database";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try { await assertRdAuthorized(request); return Response.json({ project: await rdRepository().getProject((await context.params).id) }); } catch (error) { return rdError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    await assertRdAuthorized(request);
    assertSameOrigin(request);
    return Response.json({ project: await rdRepository().removeProject((await context.params).id) });
  } catch (error) { return rdError(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    await assertRdAuthorized(request);
    assertSameOrigin(request);
    const body = await jsonBody(request) as { status?: string };
    return Response.json({ project: await rdRepository().setProjectStatus((await context.params).id, body.status) });
  } catch (error) {
    return rdError(error);
  }
}
