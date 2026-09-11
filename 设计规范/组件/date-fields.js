/** Payroll period defaults to the previous calendar month, including January rollover. */
export function setupDateFields(form, date = new Date()) {
  const prior = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  form.elements.year.replaceChildren();
  form.elements.month.replaceChildren();
  for (let year = Math.min(2000, prior.getFullYear() - 5); year <= date.getFullYear() + 5; year++) {
    form.elements.year.add(new Option(`${year}年`, year, false, year === prior.getFullYear()));
  }
  for (let month = 1; month <= 12; month++) form.elements.month.add(new Option(`${month}月`, month, false, month === prior.getMonth() + 1));
}
