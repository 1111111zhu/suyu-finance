import { assertSameOrigin, jsonBody, rdError, rdRepository } from "../_database";

export const runtime = "nodejs";

export async function GET() {
  try { return Response.json({ projects: await rdRepository().listProjects() }); } catch (error) { return rdError(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    return Response.json({ project: await rdRepository().createProject(await jsonBody(request)) }, { status: 201 });
  } catch (error) { return rdError(error); }
}
