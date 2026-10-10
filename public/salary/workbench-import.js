/* Workbook recognition and preview sampling run in a server worker. */
parseXlsxFile=async function(file,key=''){
 const result=await PayrollWorkbookAPI.json(`files/import?key=${encodeURIComponent(key)}&stage=${state.payrollStage}&month=${currentMonth}`,file,'POST',{'X-Workbook-Filename':encodeURIComponent(file.name)});
 return Object.assign(result.rows,result.metadata);
};
