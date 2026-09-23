import { assertRdAuthorized, assertSameOrigin, jsonBody, rdError, rdRepository } from "../_database";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try { assertRdAuthorized(request); return Response.json({ projects: await rdRepository().listProjects() }); } catch (error) { return rdError(error); }
}

export async function POST(request: Request) {
  try {
    assertRdAuthorized(request);
    assertSameOrigin(request);
    return Response.json({ project: await rdRepository().createProject(await jsonBody(request)) }, { status: 201 });
  } catch (error) { return rdError(error); }
}
