import {Univer,LocaleType} from '@univerjs/core';
import {UniverSheetsPlugin} from '@univerjs/sheets';
import {UniverFormulaEnginePlugin} from '@univerjs/engine-formula';
import {UniverSheetsFormulaPlugin} from '@univerjs/sheets-formula';
import {FUniver} from '@univerjs/core/facade';
import '@univerjs/sheets/facade';
import '@univerjs/sheets-formula/facade';
// Runs only in the server worker: never trust a browser's cached formula result.
export async function recalculate(snapshot) {
  if(!Object.values(snapshot.sheets).some(s=>Object.values(s.cellData||{}).some(r=>Object.values(r).some(c=>c.f))))return snapshot;
  const univer=new Univer({locale:LocaleType.EN_US,locales:{[LocaleType.EN_US]:{}}});
  try {
    univer.registerPlugin(UniverSheetsPlugin);univer.registerPlugin(UniverFormulaEnginePlugin);univer.registerPlugin(UniverSheetsFormulaPlugin);
    const api=FUniver.newAPI(univer),book=api.createWorkbook(snapshot);
    api.getFormula().executeCalculation();await api.getFormula().onCalculationResultApplied(60000);
    const calculated=book.save();
    // Retain Excel-specific metadata and unrelated plugin resources verbatim.
    for(const id of snapshot.sheetOrder) {
      const target=calculated.sheets[id];
      snapshot.sheets[id].cellData=target.cellData;
    }
    return snapshot;
  } finally {univer.dispose();}
}
