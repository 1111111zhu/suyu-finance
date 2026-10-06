import {rdError,rdRepository} from '../_database';
export const runtime='nodejs';
export async function GET() {
  try{return Response.json({items:await rdRepository().listTrash()});}catch(error){return rdError(error);}
}
