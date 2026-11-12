function setupReservationExport({ $, notify, nameOf, paymentLabel, labels, session }) {
  const fileButton = $('export-excel');
  const copyButton = $('copy-excel');
  const zone = ' (GMT+4)';
  const dateFormat = 'yyyy-mm-dd';
  const timeFormat = 'hh:mm:ss';
  const stampFormat = dateFormat + ' ' + timeFormat;
  const numberFormat = '0.00';
  const columns = [
    ['Reservation date', 19, r => r.booking_date, dateFormat],
    ['Reservation time', 20, r => r.booking_time, 'hh:mm'],
    ['Guest name', 27, nameOf],
    ['Phone', 24, r => r.phone, '@'],
    ['Guests', 11, r => number(r.guests), '0'],
    ['Table', 12, r => r.table_number, '@'],
    ['Booking status', 23, r => Object.hasOwn(labels,r.status) ? labels[r.status] : r.status],
    ['Deposit amount', 19, r => number(r.deposit_amount), numberFormat],
    ['Currency', 12, r => r.currency || 'GEL'],
    ['Payment status', 24, paymentLabel],
    ['Payment date' + zone, 24, r => localStamp(r.paid_at).slice(0,10), dateFormat],
    ['Payment time' + zone, 24, r => localStamp(r.paid_at).slice(11), timeFormat],
    ['Checked in', 14, r => Number(r.checked_in) === 1 ? 'Yes' : 'No'],
    ['Check-in time' + zone, 25, r => localStamp(r.checked_in_at), stampFormat],
    ['Comments / requests', 44, r => r.requests],
    ['Created' + zone, 25, r => localStamp(r.created_at), stampFormat],
    ['Last updated' + zone, 25, r => localStamp(r.updated_at), stampFormat],
    ['Payment callback' + zone, 27, r => localStamp(r.callback_received_at), stampFormat],
    ['Record ID', 39, r => r.id, '@'],
  ];
  let rows = [], scope = '', enabled = false, exporting = false, copying = false;
  let excelLoader;

  function number(value) {
    return value == null || value === '' || !Number.isFinite(Number(value)) ? '' : Number(value);
  }
  function localStamp(value) {
    if (!value) return '';
    const raw = String(value).trim();
    const utc = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(raw) ? raw.replace(' ','T')+'Z' : raw;
    const ms = Date.parse(utc);
    return Number.isFinite(ms) ? new Date(ms + 4 * 3600000).toISOString().slice(0,19).replace('T',' ') : '';
  }
  function syncButtons() {
    fileButton.disabled = !enabled || !rows.length || exporting;
    copyButton.disabled = !enabled || !rows.length || copying;
    fileButton.querySelector('span').textContent = exporting ? 'Exporting...' : 'Export to Excel';
  }
  function loadExcel() {
    if (!excelLoader) {
      excelLoader = new Promise((resolve,reject) => {
        const script = document.createElement('script');
        script.src = '/vendor/exceljs/exceljs.min.js';
        script.onload = () => globalThis.ExcelJS?.Workbook ? resolve(globalThis.ExcelJS) : reject(new Error('Excel writer unavailable'));
        script.onerror = () => { script.remove(); reject(new Error('Excel writer could not load')); };
        document.head.append(script);
      }).catch(error => { excelLoader = undefined; throw error; });
    }
    return excelLoader;
  }
  function dataRows() {
    return rows.map(row => columns.map(([, , value]) => value(row) ?? ''));
  }
  function workbookValue(value, format) {
    if (value === '') return null;
    if (format === dateFormat || format === stampFormat) {
      // Excel dates have no timezone; store the Tbilisi wall time as the cell value.
      const date = new Date(value.replace(' ','T') + (format === dateFormat ? 'T00:00:00Z' : 'Z'));
      return Number.isFinite(date.getTime()) ? date : value;
    }
    if (format === timeFormat || format === 'hh:mm') {
      const [hours, minutes, seconds = 0] = value.split(':').map(Number);
      if (Number.isFinite(hours + minutes + seconds)) return (hours * 3600 + minutes * 60 + seconds) / 86400;
    }
    return format === '@' ? String(value) : value;
  }
  async function download() {
    if (fileButton.disabled) return;
    const ticket = session(), filename = 'reserve-reservations-' + scope + '.xlsx';
    exporting = true;
    syncButtons();
    try {
      const data = dataRows();
      const ExcelJS = await loadExcel();
      if (ticket !== session()) return;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Reservations', { views:[{state:'frozen',ySplit:1}] });
      sheet.columns = columns.map(([header,width,,numFmt]) => ({header,width,style:numFmt ? {numFmt} : {}}));
      sheet.addRows(data.map(row => row.map((value,i) => workbookValue(value,columns[i][3]))));
      sheet.autoFilter = {from:{row:1,column:1},to:{row:data.length+1,column:columns.length}};
      const header = sheet.getRow(1);
      header.height = 24;
      header.font = {bold:true,color:{argb:'FFFFFFFF'}};
      header.fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FF333C30'}};
      header.alignment = {vertical:'middle'};
      sheet.getColumn(15).alignment = {vertical:'top',wrapText:true};
      const buffer = await workbook.xlsx.writeBuffer();
      if (ticket !== session()) return;
      const url = URL.createObjectURL(new Blob([buffer], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
      const link = document.createElement('a');
      link.href = url; link.download = filename;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      notify(`Excel file downloaded (${data.length} ${data.length === 1 ? 'reservation' : 'reservations'}).`);
    } catch {
      if (ticket === session()) notify('Could not download Excel. Try again or use Copy.');
    } finally {
      exporting = false;
      syncButtons();
    }
  }
  function clipboardValue(value, format) {
    if (typeof value === 'number') return value;
    const text = String(value).replace(/[\t\r\n]+/g,' ').replace(/[\u0000-\u001F\u007F]/g,'');
    // Keep pasted guest text literal, even when a spreadsheet auto-detects formulas.
    if (/^\s*["=+\-@\uFF1D\uFF0B\uFF0D\uFF20]/u.test(text)) return "'" + text;
    return format === '@' && /^\s*\d/.test(text) ? "'" + text : text;
  }
  function htmlEscape(value) {
    return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  }
  async function copy() {
    if (copyButton.disabled) return;
    const ticket = session();
    copying = true;
    syncButtons();
    try {
      const data = dataRows();
      const text = data.map(row => row.map((value,i) => clipboardValue(value,columns[i][3])).join('\t')).join('\r\n');
      let copied = false;
      if (navigator.clipboard?.write && typeof ClipboardItem === 'function') {
        const html = '<table>' + data.map(row => '<tr>' + row.map((value,i) => {
          const format = columns[i][3];
          const style = !format || format === '@' ? ' style="mso-number-format:\'\\@\'"' : '';
          return `<td${style}>${htmlEscape(clipboardValue(value,format))}</td>`;
        }).join('') + '</tr>').join('') + '</table>';
        try {
          await navigator.clipboard.write([new ClipboardItem({
            'text/html':new Blob([html],{type:'text/html'}),
            'text/plain':new Blob([text],{type:'text/plain'}),
          })]);
          copied = true;
        } catch {}
      }
      if (!copied && ticket === session()) await navigator.clipboard.writeText(text);
      if (ticket === session()) notify(`${data.length} ${data.length === 1 ? 'reservation' : 'reservations'} copied. Paste into Excel.`);
    } catch {
      if (ticket === session()) notify('Clipboard unavailable. Allow clipboard access or use Export to Excel.');
    } finally {
      copying = false;
      syncButtons();
    }
  }

  fileButton.addEventListener('click',download);
  copyButton.addEventListener('click',copy);
  return function update(visible, viewScope, ready) {
    rows = visible;
    scope = viewScope;
    enabled = ready;
    syncButtons();
  };
}
