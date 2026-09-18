import { rdError, rdRepository } from "../_database";

export const runtime = "nodejs";

export async function GET() {
  try {
    const data = await rdRepository().exportData();
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": "attachment; filename=rd-finance-backup.json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) { return rdError(error); }
}
